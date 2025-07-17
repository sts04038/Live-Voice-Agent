import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Power, PowerOff, Loader2 } from 'lucide-react';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  const [messages, setMessages] = useState([]);
  
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const streamRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const recordingChunkRef = useRef([]);

  // WebSocket 연결
  const connectToServer = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    
    setConnectionStatus('Connecting...');
    const ws = new WebSocket('ws://localhost:8000/ws');
    
    ws.onopen = () => {
      setIsConnected(true);
      setConnectionStatus('Connected');
      console.log('Connected to server');
      
      // 재연결 타이머 클리어
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
    
    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'audio') {
          // Base64 오디오 데이터를 디코딩하여 재생
          const audioData = atob(data.audio);
          const audioArray = new Uint8Array(audioData.length);
          for (let i = 0; i < audioData.length; i++) {
            audioArray[i] = audioData.charCodeAt(i);
          }
          
          // 오디오 큐에 추가
          audioQueueRef.current.push(audioArray);
          if (!isPlayingRef.current) {
            playAudioQueue();
          }
        } else if (data.type === 'ai_speaking_start') {
          setIsAISpeaking(true);
        } else if (data.type === 'ai_speaking_end') {
          setIsAISpeaking(false);
        } else if (data.type === 'message') {
          setMessages(prev => [...prev, { text: data.text, sender: 'ai' }]);
        } else if (data.type === 'error') {
          console.error('Server error:', data.message);
          setMessages(prev => [...prev, { text: `Error: ${data.message}`, sender: 'system' }]);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setConnectionStatus('Error');
    };
    
    ws.onclose = (event) => {
      setIsConnected(false);
      setConnectionStatus('Disconnected');
      console.log('Disconnected from server, code:', event.code, 'reason:', event.reason);
      
      // 녹음 중이었다면 중지
      if (isRecording) {
        stopRecording();
      }
      
      // 자동 재연결 (의도적 연결 해제가 아닌 경우)
      if (event.code !== 1000 && !reconnectTimeoutRef.current) {
        setConnectionStatus('Reconnecting...');
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!isConnected) {
            connectToServer();
          }
        }, 3000);
      }
    };
    
    wsRef.current = ws;
  };

  // 오디오 재생
  const playAudioQueue = async () => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      } catch (error) {
        console.error('Failed to create AudioContext:', error);
        return;
      }
    }
    
    // AudioContext가 suspended 상태라면 resume
    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume();
      } catch (error) {
        console.error('Failed to resume AudioContext:', error);
        return;
      }
    }
    
    isPlayingRef.current = true;
    
    try {
      while (audioQueueRef.current.length > 0) {
        const audioData = audioQueueRef.current.shift();
        
        // Int16 PCM을 Float32로 변환
        const float32Array = new Float32Array(audioData.length / 2);
        for (let i = 0; i < audioData.length; i += 2) {
          const int16 = (audioData[i + 1] << 8) | audioData[i];
          float32Array[i / 2] = int16 / 32768.0;
        }
        
        const audioBuffer = audioContextRef.current.createBuffer(1, float32Array.length, 24000);
        audioBuffer.getChannelData(0).set(float32Array);
        
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContextRef.current.destination);
        
        source.start();
        await new Promise(resolve => {
          source.onended = resolve;
          // 타임아웃으로 무한 대기 방지
          setTimeout(resolve, 1000);
        });
      }
    } catch (error) {
      console.error('Error playing audio:', error);
    } finally {
      isPlayingRef.current = false;
    }
  };

  // 녹음 시작
  const startRecording = async () => {
    if (!isConnected || isRecording) return;
    
    try {
      // 기존 스트림 정리
      cleanupAudioResources();
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      streamRef.current = stream;
      
      // AudioContext 생성 또는 재개
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }
      
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      
      const source = audioContextRef.current.createMediaStreamSource(stream);
      sourceRef.current = source;
      
      // AudioWorklet 또는 ScriptProcessor 사용 (더 직접적인 PCM 캡처)
      let processor;
      
      try {
        // 최신 브라우저용 AudioWorklet 시도
        await audioContextRef.current.audioWorklet.addModule(
          'data:text/javascript;base64,' + btoa(`
            class AudioProcessor extends AudioWorkletProcessor {
              process(inputs, outputs, parameters) {
                const input = inputs[0];
                if (input.length > 0) {
                  const channelData = input[0];
                  if (channelData.length > 0) {
                    // Float32를 Int16 PCM으로 변환
                    const pcmData = new Int16Array(channelData.length);
                    for (let i = 0; i < channelData.length; i++) {
                      const s = Math.max(-1, Math.min(1, channelData[i]));
                      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                    }
                    
                    // 메인 스레드로 PCM 데이터 전송
                    this.port.postMessage(pcmData.buffer);
                  }
                }
                return true;
              }
            }
            registerProcessor('audio-processor', AudioProcessor);
          `)
        );
        
        processor = new AudioWorkletNode(audioContextRef.current, 'audio-processor');
        processor.port.onmessage = (event) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            const base64 = btoa(String.fromCharCode(...new Uint8Array(event.data)));
            wsRef.current.send(JSON.stringify({
              type: 'audio',
              audio: base64
            }));
          }
        };
      } catch (error) {
        console.log('AudioWorklet not supported, falling back to ScriptProcessor');
        
        // AudioWorklet을 지원하지 않는 브라우저용 ScriptProcessor 대체
        processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
        processor.onaudioprocess = (e) => {
          if (isRecording && wsRef.current?.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            
            // Float32 PCM을 Int16 PCM으로 변환
            const pcmData = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]));
              pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
            
            // Base64로 인코딩하여 전송
            const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
            wsRef.current.send(JSON.stringify({
              type: 'audio',
              audio: base64
            }));
          }
        };
        
        // ScriptProcessor는 destination에 연결해야 함
        processor.connect(audioContextRef.current.destination);
      }
      
      source.connect(processor);
      processorRef.current = processor;
      
      setIsRecording(true);
      
      // 서버에 녹음 시작 알림
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'recording_started' }));
      }
      
      console.log('Recording started');
    } catch (error) {
      console.error('Error starting recording:', error);
      setMessages(prev => [...prev, { text: `마이크 접근 실패: ${error.message}`, sender: 'system' }]);
    }
  };

  // WebM을 PCM으로 변환하는 함수 (제거됨 - 더 이상 사용하지 않음)

  // 녹음 중지
  const stopRecording = () => {
    if (!isRecording) return;
    
    setIsRecording(false);
    
    // 오디오 프로세서 중지
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (error) {
        console.log('Error disconnecting processor:', error);
      }
      processorRef.current = null;
    }
    
    // 서버에 녹음 종료 알림
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'recording_stopped' }));
    }
    
    console.log('Recording stopped');
  };

  // 오디오 리소스 정리
  const cleanupAudioResources = () => {
    // 스트림 중지
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // 소스 연결 해제
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch (error) {
        // 이미 연결 해제된 경우 무시
      }
      sourceRef.current = null;
    }
    
    // 오디오 프로세서 정리
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch (error) {
        // 이미 연결 해제된 경우 무시
      }
      processorRef.current = null;
    }
  };

  // 마이크 토글
  const toggleRecording = async () => {
    if (!isConnected) {
      setMessages(prev => [...prev, { text: '먼저 서버에 연결해주세요.', sender: 'system' }]);
      return;
    }
    
    if (isAISpeaking) {
      setMessages(prev => [...prev, { text: 'AI가 말하는 중에는 녹음할 수 없습니다.', sender: 'system' }]);
      return;
    }
    
    if (isRecording) {
      stopRecording();
    } else {
      await startRecording();
    }
  };

  // 연결 종료
  const disconnect = () => {
    // 재연결 타이머 클리어
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // WebSocket 연결 종료
    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected'); // 정상 종료 코드
      wsRef.current = null;
    }
    
    // 녹음 중지
    if (isRecording) {
      stopRecording();
    }
    
    // 오디오 리소스 정리
    cleanupAudioResources();
    
    // 오디오 큐 클리어
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  // 스페이스바 핸들러
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
  }, [isRecording, isConnected, isAISpeaking]);

  // 컴포넌트 언마운트 시 정리
  useEffect(() => {
    return () => {
      disconnect();
      
      // AudioContext 정리
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-purple-600">
          Azure Voice Chat
        </h1>
        
        {/* 연결 상태 */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${
                isConnected ? 'bg-green-500' : connectionStatus === 'Connecting...' || connectionStatus === 'Reconnecting...' ? 'bg-yellow-500' : 'bg-red-500'
              } animate-pulse`} />
              <span className="text-lg">{connectionStatus}</span>
            </div>
            <button
              onClick={isConnected ? disconnect : connectToServer}
              disabled={connectionStatus === 'Connecting...' || connectionStatus === 'Reconnecting...'}
              className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center space-x-2 ${
                isConnected 
                  ? 'bg-red-600 hover:bg-red-700' 
                  : 'bg-blue-600 hover:bg-blue-700'
              } ${(connectionStatus === 'Connecting...' || connectionStatus === 'Reconnecting...') ? 'opacity-50 cursor-not-allowed' : ''}`}
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
            <p className="text-gray-500 text-center">No messages yet. Start talking!</p>
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