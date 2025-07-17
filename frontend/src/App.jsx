import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Mic, MicOff, Power, PowerOff, Loader2 } from 'lucide-react';

// --- App Component ---
function App() {
    // --- State Management ---
    const [isConnected, setIsConnected] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [isAISpeaking, setIsAISpeaking] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState('Disconnected');
    const [messages, setMessages] = useState([]);

    // --- Refs for managing browser APIs and state without re-renders ---
    const wsRef = useRef(null);
    const audioContextRef = useRef(null);
    const audioQueueRef = useRef([]);
    const isPlayingRef = useRef(false);
    const streamRef = useRef(null);
    const scriptProcessorRef = useRef(null);
    const mediaStreamSourceRef = useRef(null);

    // --- WebSocket Connection ---
    const connectToServer = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

        setConnectionStatus('Connecting...');
        const ws = new WebSocket('ws://localhost:8000/ws');

        ws.onopen = () => {
            setIsConnected(true);
            setConnectionStatus('Connected');
            console.log('✅ Connected to server');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'audio':
                    const audioData = atob(data.audio);
                    const audioArray = new Uint8Array(audioData.length);
                    for (let i = 0; i < audioData.length; i++) {
                        audioArray[i] = audioData.charCodeAt(i);
                    }
                    audioQueueRef.current.push(audioArray);
                    if (!isPlayingRef.current) {
                        playAudioQueue();
                    }
                    break;
                case 'response.audio.started':
                    setIsAISpeaking(true);
                    break;
                case 'response.audio.done':
                    setIsAISpeaking(false);
                    break;
                case 'error':
                    console.error('🔴 Server error:', data.message);
                    setMessages((prev) => [...prev, { text: `Error: ${data.message}`, sender: 'system' }]);
                    break;
                default:
                    break;
            }
        };

        ws.onerror = (error) => {
            console.error('🔴 WebSocket error:', error);
            setConnectionStatus('Error');
        };

        ws.onclose = () => {
            setIsConnected(false);
            setIsRecording(false);
            setConnectionStatus('Disconnected');
            console.log('🔌 Disconnected from server');
        };

        wsRef.current = ws;
    }, []);

    // --- Audio Playback Logic ---
    const playAudioQueue = useCallback(async () => {
        if (audioQueueRef.current.length === 0 || isPlayingRef.current) return;
        isPlayingRef.current = true;

        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
            audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        }
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }

        const pcmData = audioQueueRef.current.shift();
        const float32Data = new Float32Array(pcmData.length / 2);
        for (let i = 0; i < pcmData.length / 2; i++) {
            const int = pcmData[i * 2] | (pcmData[i * 2 + 1] << 8);
            float32Data[i] = int / 32768.0;
        }

        const audioBuffer = audioContextRef.current.createBuffer(1, float32Data.length, 24000);
        audioBuffer.getChannelData(0).set(float32Data);

        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        source.start();
        source.onended = () => {
            isPlayingRef.current = false;
            playAudioQueue(); // Play next chunk
        };
    }, []);

    // --- Audio Recording Logic (Using ScriptProcessor for Raw PCM) ---
    const startRecording = useCallback(async () => {
        if (!isConnected || isRecording) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
            });
            streamRef.current = stream;

            if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                audioContextRef.current = new AudioContext({ sampleRate: 24000 });
            }
            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            const source = audioContextRef.current.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;

            const bufferSize = 4096;
            const scriptProcessor = audioContextRef.current.createScriptProcessor(bufferSize, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (e) => {
                if (!isRecording || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

                const inputData = e.inputBuffer.getChannelData(0);
                // Convert Float32 to 16-bit PCM
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    const s = Math.max(-1, Math.min(1, inputData[i]));
                    pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
                }

                // Convert PCM to Base64
                const pcmBytes = new Uint8Array(pcmData.buffer);
                let binary = '';
                pcmBytes.forEach((byte) => {
                    binary += String.fromCharCode(byte);
                });
                const base64 = btoa(binary);

                wsRef.current.send(JSON.stringify({ type: 'audio', audio: base64 }));
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(audioContextRef.current.destination); // Required for script processor to run

            setIsRecording(true);
            console.log('🎤 Recording started');
        } catch (error) {
            console.error('🔴 Error starting recording:', error);
            alert('Failed to access microphone. Please check permissions.');
        }
    }, [isConnected, isRecording]);

    const stopRecording = useCallback(() => {
        if (!isRecording) return;

        setIsRecording(false);
        console.log('🔇 Recording stopped');

        // Disconnect nodes and stop stream tracks
        if (mediaStreamSourceRef.current) mediaStreamSourceRef.current.disconnect();
        if (scriptProcessorRef.current) scriptProcessorRef.current.disconnect();
        if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());

        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'recording_stopped' }));
        }
    }, [isRecording]);

    const toggleRecording = useCallback(() => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }, [isRecording, startRecording, stopRecording]);

    // --- Component Lifecycle & Event Handlers ---
    const disconnect = useCallback(() => {
        if (wsRef.current) wsRef.current.close();
    }, []);

    useEffect(() => {
        return () => disconnect();
    }, [disconnect]);

    // --- UI Rendering ---
    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 flex items-center justify-center">
            <div className="w-full max-w-4xl mx-auto">
                <h1 className="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
                    Azure Voice Chat
                </h1>

                <div className="bg-gray-800 rounded-lg p-4 sm:p-6 mb-6 shadow-xl">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                            <div
                                className={`w-3 h-3 rounded-full ${
                                    isConnected ? 'bg-green-500' : 'bg-red-500'
                                } animate-pulse`}
                            />
                            <span className="text-base sm:text-lg">{connectionStatus}</span>
                        </div>
                        <button
                            onClick={isConnected ? disconnect : connectToServer}
                            className="px-3 sm:px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2 bg-blue-600 hover:bg-blue-700"
                        >
                            {isConnected ? <PowerOff size={20} /> : <Power size={20} />}
                            <span>{isConnected ? 'Disconnect' : 'Connect'}</span>
                        </button>
                    </div>
                </div>

                <div className="bg-gray-800 rounded-lg p-6 sm:p-8 mb-6 shadow-xl">
                    <div className="flex flex-col items-center space-y-6">
                        <button
                            onClick={toggleRecording}
                            disabled={!isConnected || isAISpeaking}
                            className={`w-24 h-24 sm:w-32 sm:h-32 rounded-full transition-all duration-300 flex items-center justify-center relative ${
                                isRecording
                                    ? 'bg-red-600 hover:bg-red-700 animate-pulse shadow-lg shadow-red-500/50'
                                    : 'bg-gray-700 hover:bg-gray-600'
                            } ${!isConnected || isAISpeaking ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {isRecording ? <Mic size={40} /> : <MicOff size={40} />}
                            {isRecording && (
                                <div className="absolute inset-0 rounded-full border-4 border-red-400 animate-ping" />
                            )}
                        </button>
                        <div className="text-center h-10">
                            <p className="text-base sm:text-lg font-medium">
                                {isRecording ? 'Recording...' : 'Click to talk'}
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
            </div>
        </div>
    );
}

export default App;
