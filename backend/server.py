from __future__ import annotations

import os
import uuid
import json
import asyncio
import base64
import logging
import numpy as np
from collections import deque
from dotenv import load_dotenv
from typing import Dict, Union, Literal, Set
from typing_extensions import AsyncIterator, TypedDict, Required
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from websockets.asyncio.client import connect as ws_connect
from websockets.client import WebSocketClientProtocol as AsyncWebsocket
from websockets.asyncio.client import HeadersLike
from websockets.typing import Data
from websockets.exceptions import WebSocketException
import uvicorn

# Load environment variables
load_dotenv()

# FastAPI app setup
app = FastAPI()

# CORS middleware for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global logger
logger = logging.getLogger(__name__)
AUDIO_SAMPLE_RATE = 24000

class AsyncVoiceLiveConnection:
    """Manages WebSocket connection to Azure Voice API"""
    _connection: AsyncWebsocket

    def __init__(self, url: str, additional_headers: HeadersLike) -> None:
        self._url = url
        self._additional_headers = additional_headers
        self._connection = None

    async def __aenter__(self) -> AsyncVoiceLiveConnection:
        try:
            logger.info(f"Attempting to connect to: {self._url}")
            self._connection = await ws_connect(self._url, additional_headers=self._additional_headers)
            logger.info("WebSocket connection established successfully")
        except WebSocketException as e:
            logger.error(f"WebSocket connection failed: {e}")
            raise ValueError(f"Failed to establish a WebSocket connection: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during connection: {e}")
            raise
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        if self._connection:
            await self._connection.close()
            self._connection = None

    enter = __aenter__
    close = __aexit__

    async def __aiter__(self) -> AsyncIterator[Data]:
        async for data in self._connection:
            yield data

    async def recv(self) -> Data:
        return await self._connection.recv()

    async def recv_bytes(self) -> bytes:
        return await self._connection.recv()

    async def send(self, message: Data) -> None:
        await self._connection.send(message)

class AsyncAzureVoiceLive:
    """Azure Voice Live API client"""
    def __init__(
        self,
        *,
        azure_endpoint: str | None = None,
        api_version: str | None = None,
        token: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self._azure_endpoint = azure_endpoint
        self._api_version = api_version
        self._token = token
        self._api_key = api_key
        self._connection = None

    def connect(self, model: str) -> AsyncVoiceLiveConnection:
        if self._connection is not None:
            raise ValueError("Already connected to the Voice Live API.")
        if not model:
            raise ValueError("Model name is required.")

        url = f"{self._azure_endpoint.rstrip('/')}/voice-live/realtime?api-version={self._api_version}&model={model}"
        url = url.replace("https://", "wss://")

        auth_header = {"Authorization": f"Bearer {self._token}"} if self._token else {"api-key": self._api_key}
        request_id = uuid.uuid4()
        headers = {"x-ms-client-request-id": str(request_id), **auth_header}

        logger.info(f"Connecting to Azure Voice API:")
        logger.info(f"URL: {url}")
        logger.info(f"Request ID: {request_id}")
        logger.info(f"Using {'token' if self._token else 'API key'} authentication")

        self._connection = AsyncVoiceLiveConnection(
            url,
            additional_headers=headers,
        )
        return self._connection

class ConnectionManager:
    """Manages WebSocket connections from React clients"""
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        if client_id in self.active_connections:
            del self.active_connections[client_id]

    async def send_json(self, client_id: str, data: dict):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_json(data)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Main WebSocket endpoint for React frontend"""
    client_id = str(uuid.uuid4())
    logger.info(f"New WebSocket connection attempt from client {client_id}")
    
    try:
        await manager.connect(websocket, client_id)
        logger.info(f"WebSocket connection established for client {client_id}")
        
        # Environment variables
        endpoint = os.environ.get("AZURE_VOICE_LIVE_ENDPOINT")
        model = os.environ.get("VOICE_LIVE_MODEL") or "gpt-4o"
        api_version = os.environ.get("AZURE_VOICE_LIVE_API_VERSION") or "2025-05-01-preview"
        api_key = os.environ.get("AZURE_VOICE_LIVE_API_KEY")
        
        # Log configuration for debugging
        logger.info(f"Configuration for client {client_id}:")
        logger.info(f"Endpoint: {endpoint}")
        logger.info(f"Model: {model}")
        logger.info(f"API Version: {api_version}")
        logger.info(f"API Key present: {'Yes' if api_key else 'No'}")
        
        if not endpoint or not api_key:
            error_msg = "Azure Voice API credentials not configured. Please check environment variables."
            logger.error(f"Configuration error for client {client_id}: {error_msg}")
            await websocket.send_json({
                "type": "error",
                "message": "Azure Voice API 인증 정보가 설정되지 않았습니다. 환경 변수를 확인해주세요."
            })
            await websocket.close(code=1008, reason="Configuration error")
            return
        
        # Create Azure Voice client
        azure_client = AsyncAzureVoiceLive(
            azure_endpoint=endpoint,
            api_version=api_version,
            api_key=api_key,
        )
        
        azure_connection = None
        try:
            logger.info(f"Attempting to connect to Azure Voice API for client {client_id}")
            azure_connection = azure_client.connect(model=model)
            
            async with azure_connection as conn:
                logger.info(f"Azure connection established for client {client_id}")
                
                # Initialize session with Azure
                session_update = {
                    "type": "session.update",
                    "session": {
                        "instructions": "You are a helpful AI assistant responding in natural, engaging language. Please respond in Korean when the user speaks in Korean, and in English when the user speaks in English.",
                        "turn_detection": {
                            "type": "azure_semantic_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                            "remove_filler_words": False,
                            "end_of_utterance_detection": {
                                "model": "semantic_detection_v1",
                                "threshold": 0.01,
                                "timeout": 0.5,
                            },
                        },
                        "input_audio_noise_reduction": {
                            "type": "azure_deep_noise_suppression"
                        },
                        "input_audio_echo_cancellation": {
                            "type": "server_echo_cancellation"
                        },
                        "voice": {
                            "name": "en-US-Ava:DragonHDLatestNeural",
                            "type": "azure-standard",
                            "temperature": 0.8,
                        },
                    },
                    "event_id": str(uuid.uuid4())
                }
                
                try:
                    await conn.send(json.dumps(session_update))
                    logger.info(f"Sent session update for client {client_id}")
                except Exception as e:
                    logger.error(f"Failed to send session update for client {client_id}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Azure 세션 초기화 실패: {str(e)}"
                    })
                    return
                
                # Wait for session.created event
                try:
                    first_event = await asyncio.wait_for(conn.recv(), timeout=10.0)
                    logger.info(f"First event from Azure for client {client_id}: {first_event[:100]}...")
                    event = json.loads(first_event)
                    if event.get("type") == "session.created":
                        session_id = event.get("session", {}).get("id", "unknown")
                        logger.info(f"Session successfully created with Azure for client {client_id}: {session_id}")
                        await websocket.send_json({
                            "type": "session_created",
                            "status": "ready",
                            "session_id": session_id
                        })
                    else:
                        logger.warning(f"Unexpected first event type for client {client_id}: {event.get('type')}")
                        await websocket.send_json({
                            "type": "warning", 
                            "message": f"예상치 못한 응답: {event.get('type')}"
                        })
                except asyncio.TimeoutError:
                    error_msg = "Azure Voice API did not respond with session.created within timeout"
                    logger.error(f"Timeout waiting for session.created for client {client_id}")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Azure Voice API 세션 생성 시간 초과. 다시 시도해주세요."
                    })
                    return
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in first Azure response for client {client_id}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Azure Voice API로부터 잘못된 응답을 받았습니다."
                    })
                    return
                except Exception as e:
                    logger.error(f"Error processing first Azure event for client {client_id}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Azure Voice API 초기화 오류: {str(e)}"
                    })
                    return
                
                # Create tasks for bidirectional communication
                logger.info(f"Starting bidirectional communication tasks for client {client_id}")
                receive_from_client_task = asyncio.create_task(
                    receive_from_client(websocket, conn, client_id),
                    name=f"receive_from_client_{client_id}"
                )
                receive_from_azure_task = asyncio.create_task(
                    receive_from_azure(conn, websocket, client_id),
                    name=f"receive_from_azure_{client_id}"
                )
                
                try:
                    # Wait for any task to complete (usually due to disconnection)
                    done, pending = await asyncio.wait(
                        [receive_from_client_task, receive_from_azure_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    
                    # Log which task completed first
                    for task in done:
                        if task.exception():
                            logger.error(f"Task {task.get_name()} failed with exception: {task.exception()}")
                        else:
                            logger.info(f"Task {task.get_name()} completed normally")
                    
                    # Cancel pending tasks
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            logger.info(f"Task {task.get_name()} cancelled successfully")
                        except Exception as e:
                            logger.error(f"Error cancelling task {task.get_name()}: {e}")
                            
                except Exception as e:
                    logger.error(f"Error in communication tasks for client {client_id}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"통신 오류가 발생했습니다: {str(e)}"
                    })
                
        except ValueError as e:
            logger.error(f"Azure connection configuration error for client {client_id}: {e}")
            await websocket.send_json({
                "type": "error",
                "message": f"Azure Voice API 연결 설정 오류: {str(e)}"
            })
        except Exception as e:
            logger.error(f"Error establishing Azure connection for client {client_id}: {e}")
            await websocket.send_json({
                "type": "error", 
                "message": f"Azure Voice API 연결 실패: {str(e)}"
            })
            
    except WebSocketDisconnect as e:
        logger.info(f"Client {client_id} disconnected normally (code: {e.code}, reason: {e.reason})")
    except Exception as e:
        logger.error(f"Unexpected error in websocket connection for client {client_id}: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"서버 오류가 발생했습니다: {str(e)}"
            })
        except Exception:
            logger.error(f"Failed to send error message to client {client_id}")
    finally:
        manager.disconnect(client_id)
        logger.info(f"Client {client_id} cleanup completed")

async def receive_from_client(websocket: WebSocket, azure_connection: AsyncVoiceLiveConnection, client_id: str):
    """Receive messages from React client and forward to Azure"""
    audio_buffer = bytearray()
    
    try:
        while True:
            try:
                # 타임아웃을 설정하여 무한 대기 방지
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)
                message_type = data.get("type")
                
                if message_type == "audio":
                    # Accumulate audio data
                    audio_base64 = data.get("audio")
                    if not audio_base64:
                        logger.warning(f"Empty audio data received from client {client_id}")
                        continue
                        
                    try:
                        audio_bytes = base64.b64decode(audio_base64)
                        audio_buffer.extend(audio_bytes)
                        
                        # Send audio in chunks if buffer is large enough
                        chunk_size = int(AUDIO_SAMPLE_RATE * 0.1 * 2)  # 100ms of 16-bit audio
                        while len(audio_buffer) >= chunk_size:
                            chunk = audio_buffer[:chunk_size]
                            audio_buffer = audio_buffer[chunk_size:]
                            
                            # Convert to base64 and send to Azure
                            chunk_base64 = base64.b64encode(chunk).decode("utf-8")
                            azure_message = {
                                "type": "input_audio_buffer.append",
                                "audio": chunk_base64,
                                "event_id": ""
                            }
                            await azure_connection.send(json.dumps(azure_message))
                    except Exception as e:
                        logger.error(f"Error processing audio data: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "message": f"오디오 처리 중 오류가 발생했습니다: {str(e)}"
                        })
                    
                elif message_type == "recording_started":
                    # Clear any previous audio and cancel responses
                    logger.info(f"Recording started for client {client_id}")
                    audio_buffer.clear()
                    
                    try:
                        cancel_message = {
                            "type": "response.cancel",
                            "event_id": ""
                        }
                        await azure_connection.send(json.dumps(cancel_message))
                        
                        clear_message = {
                            "type": "input_audio_buffer.clear",
                            "event_id": ""
                        }
                        await azure_connection.send(json.dumps(clear_message))
                    except Exception as e:
                        logger.error(f"Error sending recording start commands to Azure: {e}")
                    
                elif message_type == "recording_stopped":
                    logger.info(f"Recording stopped for client {client_id}")
                    
                    try:
                        # Send any remaining audio in buffer
                        if len(audio_buffer) > 0:
                            remaining_base64 = base64.b64encode(audio_buffer).decode("utf-8")
                            azure_message = {
                                "type": "input_audio_buffer.append",
                                "audio": remaining_base64,
                                "event_id": ""
                            }
                            await azure_connection.send(json.dumps(azure_message))
                            audio_buffer.clear()
                        
                        # Send silence and commit
                        silence_duration = 0.8  # seconds
                        silence_samples = int(AUDIO_SAMPLE_RATE * silence_duration)
                        chunk_size = int(AUDIO_SAMPLE_RATE * 0.02)  # 20ms chunks
                        
                        # Send silence in chunks
                        for i in range(0, silence_samples, chunk_size):
                            silence_data = np.zeros(min(chunk_size, silence_samples - i), dtype=np.int16)
                            audio_base64 = base64.b64encode(silence_data.tobytes()).decode("utf-8")
                            silence_message = {
                                "type": "input_audio_buffer.append",
                                "audio": audio_base64,
                                "event_id": ""
                            }
                            await azure_connection.send(json.dumps(silence_message))
                        
                        # Commit the audio buffer
                        commit_message = {
                            "type": "input_audio_buffer.commit",
                            "event_id": ""
                        }
                        await azure_connection.send(json.dumps(commit_message))
                        logger.info(f"Audio committed for client {client_id}")
                    except Exception as e:
                        logger.error(f"Error processing recording stop: {e}")
                        await websocket.send_json({
                            "type": "error",
                            "message": f"녹음 종료 처리 중 오류가 발생했습니다: {str(e)}"
                        })
                        
                else:
                    logger.warning(f"Unknown message type received: {message_type}")
                    
            except asyncio.TimeoutError:
                logger.debug(f"Receive timeout for client {client_id}, sending ping")
                # 연결 상태 확인을 위한 ping 전송
                try:
                    await websocket.send_json({"type": "ping"})
                except Exception:
                    logger.warning(f"Failed to send ping to client {client_id}")
                    break
            except ValueError as e:
                logger.error(f"Invalid JSON received from client {client_id}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": "잘못된 메시지 형식입니다."
                })
            except Exception as e:
                logger.error(f"Error receiving message from client {client_id}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": f"메시지 처리 중 오류가 발생했습니다: {str(e)}"
                })
                
    except WebSocketDisconnect as e:
        logger.info(f"Client {client_id} disconnected normally (code: {e.code})")
    except Exception as e:
        logger.error(f"Unexpected error in receive_from_client for {client_id}: {e}")
    finally:
        logger.info(f"Cleaning up receive_from_client for {client_id}")

async def receive_from_azure(azure_connection: AsyncVoiceLiveConnection, websocket: WebSocket, client_id: str):
    """Receive messages from Azure and forward to React client"""
    try:
        async for raw_event in azure_connection:
            try:
                event = json.loads(raw_event)
                event_type = event.get("type")
                
                # Log all events for debugging (except frequent audio deltas)
                if event_type != "response.audio.delta":
                    logger.info(f"Azure event for client {client_id}: {event_type}")
                
                if event_type == "session.created":
                    session = event.get("session", {})
                    session_id = session.get('id', 'unknown')
                    logger.info(f"Azure session created for client {client_id}: {session_id}")
                    await websocket.send_json({
                        "type": "session_created",
                        "session_id": session_id
                    })
                    
                elif event_type == "response.audio.delta":
                    # Forward audio delta to client
                    audio_delta = event.get("delta", "")
                    if audio_delta:  # Only send non-empty deltas
                        await websocket.send_json({
                            "type": "audio",
                            "audio": audio_delta
                        })
                    
                elif event_type == "response.audio.started":
                    logger.info(f"AI started speaking for client {client_id}")
                    await websocket.send_json({
                        "type": "ai_speaking_start"
                    })
                    
                elif event_type == "response.audio.done":
                    logger.info(f"AI finished speaking for client {client_id}")
                    await websocket.send_json({
                        "type": "ai_speaking_end"
                    })
                    
                elif event_type == "conversation.item.created":
                    # Extract and send text content if available
                    item = event.get("item", {})
                    if item.get("type") == "message" and item.get("role") == "assistant":
                        content = item.get("content", [])
                        for content_item in content:
                            if content_item.get("type") == "text":
                                text = content_item.get("text", "")
                                if text:
                                    logger.info(f"AI response text for client {client_id}: {text}")
                                    await websocket.send_json({
                                        "type": "message",
                                        "text": text
                                    })
                                    
                elif event_type == "input_audio_buffer.speech_started":
                    logger.info(f"Speech detected for client {client_id}")
                    await websocket.send_json({
                        "type": "speech_detected"
                    })
                    
                elif event_type == "input_audio_buffer.speech_stopped":
                    logger.info(f"Speech stopped for client {client_id}")
                    await websocket.send_json({
                        "type": "speech_stopped"
                    })
                    
                elif event_type == "error":
                    error_details = event.get("error", {})
                    error_message = error_details.get("message", "Unknown error")
                    error_type = error_details.get("type", "unknown")
                    error_code = error_details.get("code", "unknown")
                    
                    logger.error(f"Azure error for client {client_id}: {error_type} ({error_code}): {error_message}")
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Azure 오류: {error_message}"
                    })
                    
                elif event_type == "rate_limits.updated":
                    # Rate limit information - can be useful for monitoring
                    rate_limits = event.get("rate_limits", [])
                    logger.info(f"Rate limits updated for client {client_id}: {rate_limits}")
                    
                else:
                    logger.debug(f"Unhandled Azure event type for client {client_id}: {event_type}")
                    
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON from Azure for client {client_id}: {e}")
            except Exception as e:
                logger.error(f"Error processing Azure event for client {client_id}: {e}")
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Azure 이벤트 처리 중 오류가 발생했습니다: {str(e)}"
                    })
                except Exception:
                    # If we can't send error message, connection is likely broken
                    logger.error(f"Failed to send error message to client {client_id}")
                    break
                
    except Exception as e:
        logger.error(f"Error in receive_from_azure for client {client_id}: {e}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Azure 연결에 문제가 발생했습니다: {str(e)}"
            })
        except Exception:
            logger.error(f"Failed to send Azure connection error to client {client_id}")
    finally:
        logger.info(f"Cleaning up receive_from_azure for {client_id}")

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "Azure Voice Chat server is running"}

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "azure-voice-chat"}

if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Run the server
    uvicorn.run(
        "server:app",  # Change "server" to your filename if different
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )