from __future__ import annotations

import os
import uuid
import json
import asyncio
import base64
import logging
import threading
import numpy as np
import sounddevice as sd

from collections import deque
from dotenv import load_dotenv
from azure.identity import DefaultAzureCredential
from azure.core.credentials_async import AsyncTokenCredential
from azure.identity.aio import DefaultAzureCredential, get_bearer_token_provider
from typing import Dict, Union, Literal, Set
from typing_extensions import AsyncIterator, TypedDict, Required
from websockets.asyncio.client import connect as ws_connect
from websockets.asyncio.client import ClientConnection as AsyncWebsocket
from websockets.asyncio.client import HeadersLike
from websockets.typing import Data
from websockets.exceptions import WebSocketException

# This is the main function to run the Voice Live API client.

async def main() -> None:
    # Set environment variables or edit the corresponding values here.
    endpoint = os.environ.get("AZURE_VOICE_LIVE_ENDPOINT") or "https://your-endpoint.azure.com/"
    model = os.environ.get("VOICE_LIVE_MODEL") or "gpt-4o"
    api_version = os.environ.get("AZURE_VOICE_LIVE_API_VERSION") or "2025-05-01-preview"
    api_key = os.environ.get("AZURE_VOICE_LIVE_API_KEY") or "your_api_key"

    # # msal 로그인 방식
    # # For the recommended keyless authentication, get and
    # # use the Microsoft Entra token instead of api_key:
    # scopes = "https://cognitiveservices.azure.com/.default"
    # credential = DefaultAzureCredential()
    # token = await credential.get_token(scopes)

    client = AsyncAzureVoiceLive(
        azure_endpoint = endpoint,
        api_version = api_version,
        # token = token.token, # Msal 로그인 방식
        api_key = api_key,
    )
    async with client.connect(model = model) as connection:
        session_update = {
            "type": "session.update",
            "session": {
                "instructions": "You are a helpful AI assistant responding in natural, engaging language.",
                "turn_detection": {
                    "type": "azure_semantic_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 2000, # 2초 침묵 -> ai 대화 끝으로 판단
                    "remove_filler_words": False,
                    "end_of_utterance_detection": {
                        "model": "semantic_detection_v1",
                        "threshold": 0.01,
                        "timeout": 2,
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
            "event_id": ""
        }
        await connection.send(json.dumps(session_update))
        print("Session created: ", json.dumps(session_update))

        send_task = asyncio.create_task(listen_and_send_audio(connection))
        receive_task = asyncio.create_task(receive_audio_and_playback(connection))
        keyboard_task = asyncio.create_task(read_keyboard_and_quit())

        print("Starting the chat ...")
        await asyncio.wait([send_task, receive_task, keyboard_task], return_when=asyncio.FIRST_COMPLETED)

        send_task.cancel()
        receive_task.cancel()
        print("Chat done.")

# --- End of Main Function ---

logger = logging.getLogger(__name__)
AUDIO_SAMPLE_RATE = 24000

class AsyncVoiceLiveConnection:
    _connection: AsyncWebsocket

    def __init__(self, url: str, additional_headers: HeadersLike) -> None:
        self._url = url
        self._additional_headers = additional_headers
        self._connection = None

    async def __aenter__(self) -> AsyncVoiceLiveConnection:
        try:
            self._connection = await ws_connect(self._url, additional_headers=self._additional_headers)
        except WebSocketException as e:
            raise ValueError(f"Failed to establish a WebSocket connection: {e}")
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

        self._connection = AsyncVoiceLiveConnection(
            url,
            additional_headers=headers,
        )
        return self._connection

class AudioPlayerAsync:
    def __init__(self):
        self.queue = deque()
        self.lock = threading.Lock()
        self.stream = sd.OutputStream(
            callback=self.callback,
            samplerate=AUDIO_SAMPLE_RATE,
            channels=1,
            dtype=np.int16,
            blocksize=2400,
        )
        self.playing = False

    def callback(self, outdata, frames, time, status):
        if status:
            logger.warning(f"Stream status: {status}")
        with self.lock:
            data = np.empty(0, dtype=np.int16)
            while len(data) < frames and len(self.queue) > 0:
                item = self.queue.popleft()
                frames_needed = frames - len(data)
                data = np.concatenate((data, item[:frames_needed]))
                if len(item) > frames_needed:
                    self.queue.appendleft(item[frames_needed:])
            if len(data) < frames:
                data = np.concatenate((data, np.zeros(frames - len(data), dtype=np.int16)))
        outdata[:] = data.reshape(-1, 1)

    def add_data(self, data: bytes):
        with self.lock:
            np_data = np.frombuffer(data, dtype=np.int16)
            self.queue.append(np_data)
            if not self.playing and len(self.queue) > 10:
                self.start()

    def start(self):
        if not self.playing:
            self.playing = True
            self.stream.start()

    def stop(self):
        with self.lock:
            self.queue.clear()
        self.playing = False
        self.stream.stop()

    def terminate(self):
        with self.lock:
            self.queue.clear()
        self.stream.stop()
        self.stream.close()

async def listen_and_send_audio(connection: AsyncVoiceLiveConnection) -> None:
    logger.info("Starting audio stream ...")

    stream = sd.InputStream(channels=1, samplerate=AUDIO_SAMPLE_RATE, dtype="int16")
    try:
        stream.start()
        read_size = int(AUDIO_SAMPLE_RATE * 0.02)
        while True:
            if stream.read_available >= read_size:
                data, _ = stream.read(read_size)
                audio = base64.b64encode(data).decode("utf-8")
                param = {"type": "input_audio_buffer.append", "audio": audio, "event_id": ""}
                data_json = json.dumps(param)
                await connection.send(data_json)
    except Exception as e:
        logger.error(f"Audio stream interrupted. {e}")
    finally:
        stream.stop()
        stream.close()
        logger.info("Audio stream closed.")

async def receive_audio_and_playback(connection: AsyncVoiceLiveConnection) -> None:
    last_audio_item_id = None
    audio_player = AudioPlayerAsync()

    logger.info("Starting audio playback ...")
    try:
        while True:
            async for raw_event in connection:
                event = json.loads(raw_event)
                print(f"Received event:", {event.get("type")})

                if event.get("type") == "session.created":
                    session = event.get("session")
                    logger.info(f"Session created: {session.get('id')}")

                elif event.get("type") == "response.audio.delta":
                    if event.get("item_id") != last_audio_item_id:
                        last_audio_item_id = event.get("item_id")

                    bytes_data = base64.b64decode(event.get("delta", ""))
                    audio_player.add_data(bytes_data)

                elif event.get("type") == "error":
                    error_details = event.get("error", {})
                    error_type = error_details.get("type", "Unknown")
                    error_code = error_details.get("code", "Unknown")
                    error_message = error_details.get("message", "No message provided")
                    raise ValueError(f"Error received: Type={error_type}, Code={error_code}, Message={error_message}")

    except Exception as e:
        logger.error(f"Error in audio playback: {e}")
    finally:
        audio_player.terminate()
        logger.info("Playback done.")

async def read_keyboard_and_quit() -> None:
    print("Press 'q' and Enter to quit the chat.")
    while True:
        # Run input() in a thread to avoid blocking the event loop
        user_input = await asyncio.to_thread(input)
        if user_input.strip().lower() == 'q':
            print("Quitting the chat...")
            break

if __name__ == "__main__":
    try:
        logging.basicConfig(
            filename='voicelive.log',
            filemode="w",
            level=logging.DEBUG,
            format='%(asctime)s:%(name)s:%(levelname)s:%(message)s'
        )
        load_dotenv()
        asyncio.run(main())
    except Exception as e:
        print(f"Error: {e}")