import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Power, PowerOff, Loader2 } from 'lucide-react';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isAISpeaking, setIsAISpeaking] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');

    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const streamRef = useRef(null);
    const processorRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);

    // 오디오 데이터를 서버로 전송하는 함수
    const sendAudioData = useCallback((int16Data) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            // Int16Array를 Base64 문자열로 변환
            const u8 = new Uint8Array(int16Data.buffer);
            const base64 = btoa(String.fromCharCode.apply(null, u8));
            wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64 }));
        }
    }, []);

    // 녹음 시작 함수
    const startRecording = useCallback(async () => {
        if (!isConnected || isRecording) return;
        setIsRecording(true);
        console.log('🎤 Recording started');

        try {
            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext({ sampleRate: 24000 });
            }
            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
            });
            streamRef.current = stream;
            sourceNodeRef.current = audioContextRef.current.createMediaStreamSource(stream);

            // AudioWorklet을 사용하는 것이 권장되지만, ScriptProcessorNode를 사용한 예제 유지
            const bufferSize = 4096;
            const processor = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
            processorRef.current = processor;

            processor.onaudioprocess = (e) => {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 32767;
                }
                // 녹음 중일 때만 오디오 데이터 전송
                if (isRecordingRef.current) {
                    sendAudioData(pcmData);
                }
            };

            sourceNodeRef.current.connect(processor);
            processor.connect(audioContextRef.current.destination);
        } catch (error) {
            console.error('🔴 Error starting recording:', error);
            alert('Failed to access microphone. Please check permissions.');
            setIsRecording(false);
        }
    }, [isConnected, sendAudioData]);

    const isRecordingRef = useRef(isRecording);
    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    // 녹음 중지 함수
    const stopRecording = useCallback(() => {
        if (!isRecordingRef.current) return;
        setIsRecording(false);
        console.log('🔇 Recording stopped');

        if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop());
            streamRef.current = null;
        }
        if (sourceNodeRef.current) {
            sourceNodeRef.current.disconnect();
            sourceNodeRef.current = null;
        }
        if (processorRef.current) {
            processorRef.current.disconnect();
            processorRef.current = null;
        }

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'recording_stopped' }));
        }
    }, []);

    // 녹음 토글
    const toggleRecording = useCallback(() => {
        !isRecording ? startRecording() : stopRecording();
    }, [isRecording, startRecording, stopRecording]);

    // 오디오 큐를 재생하는 함수 (부드러운 재생을 위해 개선)
    const playAudioQueue = useCallback(async () => {
        if (audioQueueRef.current.length === 0 || isPlayingRef.current) return;

        isPlayingRef.current = true;
        setIsAISpeaking(true);

        const totalLength = audioQueueRef.current.reduce((acc, val) => acc + val.length, 0);
        const concatenatedData = new Uint8Array(totalLength);
        let offset = 0;
        audioQueueRef.current.forEach((chunk) => {
            concatenatedData.set(chunk, offset);
            offset += chunk.length;
        });
        audioQueueRef.current = [];

        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        try {
            const pcmData = new Int16Array(concatenatedData.buffer);
            const float32Data = new Float32Array(pcmData.length);
            for (let i = 0; i < pcmData.length; i++) {
                float32Data[i] = pcmData[i] / 32768.0;
            }

            const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
            audioBuffer.getChannelData(0).set(float32Data);

            const source = audioContextRef.current.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContextRef.current.destination);
            source.start();

            source.onended = () => {
                isPlayingRef.current = false;
                if (audioQueueRef.current.length > 0) {
                    playAudioQueue();
                } else {
                    setIsAISpeaking(false);
                }
            };
        } catch (error) {
            console.error('🔴 Error playing audio:', error);
            isPlayingRef.current = false;
            setIsAISpeaking(false);
        }
    }, []);

    // 서버 연결 함수
    const connect = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
        setConnectionStatus('Connecting...');
        const ws = new WebSocket('ws://localhost:8000/ws');
        wsRef.current = ws;

        ws.onopen = () => {
            setIsConnected(true);
            setConnectionStatus('Connected');
            console.log('✅ Connected to server');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'audio' && data.audio) {
                const audioData = atob(data.audio);
                const audioArray = new Uint8Array(audioData.length);
                for (let i = 0; i < audioData.length; i++) {
                    audioArray[i] = audioData.charCodeAt(i);
                }
                audioQueueRef.current.push(audioArray);
                if (!isPlayingRef.current) {
                    playAudioQueue();
                }
            } else if (data.type === 'response.audio.started') {
                // audio.delta가 들어올 때 isAISpeaking을 true로 설정하는 것이 더 정확할 수 있음
            }
        };

        ws.onerror = (error) => console.error('🔴 WebSocket error:', error);
        ws.onclose = () => {
            setIsConnected(false);
            setConnectionStatus('Disconnected');
            stopRecording();
            wsRef.current = null;
            console.log('🔌 Disconnected from server');
        };
    }, [stopRecording, playAudioQueue]);

    // 서버 연결 해제 함수
    const disconnect = useCallback(() => {
        if (wsRef.current) {
            wsRef.current.close();
        }
    }, []);

    // 컴포넌트 언마운트 시 연결 해제
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-900 text-white p-4 flex items-center justify-center">
            <div className="w-full max-w-md mx-auto">
                <h1 className="text-3xl font-bold mb-6 text-center text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    Live Voice Agent
                </h1>
                <div className="bg-gray-800 rounded-lg p-4 mb-6 shadow-lg">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div
                                className={`w-3 h-3 rounded-full ${
                                    isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                                }`}
                            />
                            <span>{connectionStatus}</span>
                        </div>
                        <button
                            onClick={isConnected ? disconnect : connect}
                            className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center space-x-2 transition-colors ${
                                isConnected ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            {isConnected ? <PowerOff size={16} /> : <Power size={16} />}
                            <span>{isConnected ? 'Disconnect' : 'Connect'}</span>
                        </button>
                    </div>
                </div>
                <div className="bg-gray-800 rounded-lg p-6 shadow-lg flex flex-col items-center">
                    <button
                        onClick={toggleRecording}
                        disabled={!isConnected || isAISpeaking}
                        className={`w-28 h-28 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out border-4 border-transparent ${
                            isRecording
                                ? 'bg-red-500 scale-110 shadow-lg shadow-red-500/50 border-red-400'
                                : 'bg-gray-700 hover:border-gray-500'
                        } disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-transparent`}
                    >
                        {isRecording ? <MicOff size={48} /> : <Mic size={48} />}
                    </button>
                    <div className="h-8 mt-4 text-center text-sm text-gray-400">
                        {isAISpeaking && (
                            <div className="flex items-center space-x-2 text-blue-400">
                                <Loader2 className="animate-spin" />
                                <span>AI is speaking...</span>
                            </div>
                        )}
                        {!isAISpeaking && isConnected && (
                            <span>{isRecording ? 'Listening...' : 'Press mic to speak'}</span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default App;
