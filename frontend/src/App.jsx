import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Power, PowerOff, Loader2 } from 'lucide-react';

function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isAISpeaking, setIsAISpeaking] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    const [messages, setMessages] = useState([]);

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
            setMessages(prev => [...prev, { text: `Failed to access microphone: ${error.message}`, sender: 'system' }]);
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
        if (!isConnected) {
            setMessages(prev => [...prev, { text: 'Please connect to server first', sender: 'system' }]);
            return;
        }
        if (isAISpeaking) {
            setMessages(prev => [...prev, { text: 'Cannot record while AI is speaking', sender: 'system' }]);
            return;
        }
        !isRecording ? startRecording() : stopRecording();
    }, [isRecording, isConnected, isAISpeaking, startRecording, stopRecording]);

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

            // AI가 말하기 시작했다는 신호
            if (data.type === 'response.audio.started') {
                setIsAISpeaking(true);
                setMessages(prev => [...prev, { text: 'AI is responding...', sender: 'ai' }]);
                return;
            }

            // AI 말이 끝났다는 신호
            if (data.type === 'response.audio.done') {
                // onended 콜백에서 처리하므로 여기서는 비워둡니다.
                return;
            }

            if (data.type === 'audio' && data.audio) {
                // AI가 말하고 있다는 것을 명시적으로 설정
                if (!isAISpeaking) setIsAISpeaking(true);

                const audioData = atob(data.audio);
                const audioArray = new Uint8Array(audioData.length);
                for (let i = 0; i < audioData.length; i++) {
                    audioArray[i] = audioData.charCodeAt(i);
                }
                audioQueueRef.current.push(audioArray);
                if (!isPlayingRef.current) {
                    playAudioQueue();
                }
            }

            // 텍스트 메시지 처리 (서버에서 전송하는 경우)
            if (data.type === 'message') {
                setMessages(prev => [...prev, { text: data.text, sender: 'ai' }]);
            }

            // 에러 메시지 처리
            if (data.type === 'error') {
                console.error('🔴 Server error:', data.message);
                setMessages(prev => [...prev, { text: `Error: ${data.message}`, sender: 'system' }]);
            }
        };

        ws.onerror = (error) => {
            console.error('🔴 WebSocket error:', error);
            setConnectionStatus('Error');
        };

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

    // 스페이스바 핸들러 추가
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.code === 'Space' && !isRecording && isConnected && !isAISpeaking) {
                e.preventDefault();
                startRecording();
            }
        };

        const handleKeyUp = (e) => {
            if (e.code === 'Space' && isRecording) {
                e.preventDefault();
                stopRecording();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [isRecording, isConnected, isAISpeaking, startRecording, stopRecording]);

    // 컴포넌트 언마운트 시 연결 해제
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
                    Live Voice Agent
                </h1>
                
                {/* 연결 상태 */}
                <div className="bg-gray-800 rounded-lg p-6 mb-6 shadow-xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div className={`w-3 h-3 rounded-full ${
                                isConnected ? 'bg-green-500' : 'bg-red-500'
                            } animate-pulse`} />
                            <span className="text-lg">{connectionStatus}</span>
                        </div>
                        <button
                            onClick={isConnected ? disconnect : connect}
                            className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2 ${
                                isConnected 
                                    ? 'bg-red-600 hover:bg-red-700' 
                                    : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            {isConnected ? <PowerOff size={20} /> : <Power size={20} />}
                            <span>{isConnected ? 'Disconnect' : 'Connect'}</span>
                        </button>
                    </div>
                </div>

                {/* 메인 컨트롤 */}
                <div className="bg-gray-800 rounded-lg p-8 mb-6 shadow-xl">
                    <div className="flex flex-col items-center space-y-6">
                        {/* 마이크 버튼 */}
                        <button
                            onClick={toggleRecording}
                            disabled={!isConnected || isAISpeaking}
                            className={`w-32 h-32 rounded-full transition-all duration-300 flex items-center justify-center relative ${
                                isRecording 
                                    ? 'bg-red-600 hover:bg-red-700 animate-pulse shadow-lg shadow-red-500/50' 
                                    : 'bg-gray-700 hover:bg-gray-600'
                            } ${(!isConnected || isAISpeaking) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isRecording ? <Mic size={48} /> : <MicOff size={48} />}
                            {isRecording && (
                                <div className="absolute inset-0 rounded-full border-4 border-red-400 animate-ping" />
                            )}
                        </button>
                        
                        <div className="text-center">
                            <p className="text-lg font-medium">
                                {isRecording ? 'Recording... Release to send' : 'Hold SPACE or click to talk'}
                            </p>
                            {isAISpeaking && (
                                <div className="flex items-center justify-center space-x-2 mt-2">
                                    <Loader2 className="animate-spin" size={16} />
                                    <span className="text-blue-400">AI is speaking...</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 메시지 히스토리 */}
                <div className="bg-gray-800 rounded-lg p-6 shadow-xl max-h-96 overflow-y-auto">
                    <h2 className="text-xl font-semibold mb-4">Conversation</h2>
                    {messages.length === 0 ? (
                        <p className="text-gray-500 text-center">coming soon!</p>
                    ) : (
                        <div className="space-y-3">
                            {messages.map((msg, idx) => (
                                <div
                                    key={idx}
                                    className={`p-3 rounded-lg ${
                                        msg.sender === 'user' 
                                            ? 'bg-blue-600 ml-auto max-w-xs' 
                                            : msg.sender === 'ai'
                                            ? 'bg-gray-700 mr-auto max-w-xs'
                                            : 'bg-yellow-600 mx-auto max-w-md text-center'
                                    }`}
                                >
                                    <p className="text-sm">{msg.text}</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 사용 안내 */}
                <div className="mt-6 text-center text-gray-400 text-sm">
                    <p>Press and hold SPACE key or click the microphone button to talk</p>
                    <p>Release to send your message to the AI</p>
                </div>
            </div>
        </div>
    );
}

export default App;