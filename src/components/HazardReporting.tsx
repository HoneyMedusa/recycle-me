import React, { useState, useRef, useEffect } from 'react';
import { analyzeHazardImage, getAddressFromCoords, transcribeAudio } from '../services/gemini';
import { HazardReport } from '../types';

interface HazardReportingProps {
  onReportSubmitted: () => void;
}

// Helper function for encoding audio
const encodeUint8Array = (data: Uint8Array): string => {
  let binary = '';
  const len = data.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
};

const HazardReporting: React.FC<HazardReportingProps> = ({ onReportSubmitted }) => {
  const [image, setImage] = useState<string | null>(null);
  const [locationText, setLocationText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [reportResult, setReportResult] = useState<Partial<HazardReport> | null>(null);

  // Camera States
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Audio States
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasMicrophone, setHasMicrophone] = useState<boolean | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const pcmDataRef = useRef<Int16Array[]>([]);

  // Location States
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [locationGrounding, setLocationGrounding] = useState<{ url?: string; title?: string } | null>(null);

  useEffect(() => {
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then(() => setHasMicrophone(true))
      .catch(() => setHasMicrophone(false));
    
    return () => {
      stopCamera();
    };
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      streamRef.current = stream;
      setIsCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);
    } catch (err) {
      console.error("Camera access error:", err);
    }
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      setImage(canvas.toDataURL('image/jpeg'));
      stopCamera();
    }
  };

  const startRecording = async () => {
    setAudioError(null);
    pcmDataRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 16000 } });
      audioStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        let sum = 0;
        for (let i = 0; i < input.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
          sum += input[i] * input[i];
        }
        pcmDataRef.current.push(pcm16);
        setAudioLevel(Math.sqrt(sum / input.length));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setIsRecording(true);
    } catch (err) {
      setAudioError("Microphone access denied.");
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setIsRecording(false);
    setAudioLevel(0);
    setIsTranscribing(true);
    const sampleRate = audioContextRef.current?.sampleRate || 16000;
    try {
      if (processorRef.current) processorRef.current.disconnect();
      if (audioStreamRef.current) audioStreamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) await audioContextRef.current.close();
      if (pcmDataRef.current.length > 0) {
        const total = pcmDataRef.current.reduce((acc, curr) => acc + curr.length, 0);
        const merged = new Int16Array(total);
        let offset = 0;
        for (const chunk of pcmDataRef.current) { merged.set(chunk, offset); offset += chunk.length; }
        const base64 = encodeUint8Array(new Uint8Array(merged.buffer));
        const text = await transcribeAudio(base64, sampleRate);
        if (text) setTranscript(prev => (prev + ' ' + text).trim());
        else setAudioError("Transcription empty. Please speak louder.");
      }
    } catch (e) {
      setAudioError("Transcription failed.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const detectLocation = () => {
    setIsDetectingLocation(true);
    setLocationGrounding(null);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { address, url, title } = await getAddressFromCoords(pos.coords.latitude, pos.coords.longitude);
          setLocationText(address);
          if (url) setLocationGrounding({ url, title });
        } catch (err) {
          setLocationText(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`);
        } finally {
          setIsDetectingLocation(false);
        }
      }, () => {
        setIsDetectingLocation(false);
        alert("GPS denied. Please enter manually.");
      });
    } else {
      setIsDetectingLocation(false);
      alert("GPS not supported.");
    }
  };

  const submitReport = async () => {
    if (!image) return;
    setIsProcessing(true);
    try {
      const result = await analyzeHazardImage(image.split(',')[1], `Location: ${locationText}. Context: ${transcript}`);
      setReportResult(result);
      onReportSubmitted();
    } catch (err) {
      alert("Analysis failed. Try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8 animate-in slide-in-from-right-10 duration-500 pb-12">
      <div className="glass-morphism p-6 rounded-[2rem] border-l-4 border-pink-500 bg-pink-500/5">
        <h3 className="text-xl font-bangers text-pink-400 mb-2 uppercase tracking-widest">Community Guardian</h3>
        <p className="text-slate-300 text-sm leading-relaxed">
          Reporting illegal dumping or hazardous spills protects your community. Document the hazard and our AI will alert municipal teams for rapid response.
        </p>
      </div>

      {!reportResult ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-6">
              <div className="glass-morphism p-6 rounded-3xl border border-white/10 flex flex-col items-center justify-center min-h-[350px] relative overflow-hidden bg-slate-900/40">
                {isCameraActive ? (
                  <div className="absolute inset-0 w-full h-full flex flex-col">
                    <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
                    <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4">
                      <button onClick={capturePhoto} className="bg-white text-slate-900 p-4 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all">
                        <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                      </button>
                      <button onClick={stopCamera} className="bg-black/50 text-white p-4 rounded-full backdrop-blur-md border border-white/10">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  </div>
                ) : image ? (
                  <img src={image} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="text-center space-y-4">
                    <button onClick={startCamera} className="px-8 py-3 rounded-2xl funky-gradient text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 5a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-1.586a1 1 0 01-.707-.293l-1.121-1.121A2 2 0 0011.172 3H8.828a2 2 0 00-1.414.586L6.293 4.707A1 1 0 015.586 5H4zm6 9a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" /></svg>
                      Open Camera
                    </button>
                    <label className="bg-slate-800 px-8 py-3 rounded-2xl text-slate-300 border border-slate-700 cursor-pointer text-xs font-bold uppercase tracking-widest block">
                      Upload File
                      <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if(f) { const r = new FileReader(); r.onload = () => setImage(r.result as string); r.readAsDataURL(f); } }} className="hidden" />
                    </label>
                  </div>
                )}
                <canvas ref={canvasRef} className="hidden" />
              </div>
              
              <div className="glass-morphism p-6 rounded-3xl border border-white/10 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-300 text-xs uppercase tracking-widest">Hazard Location</h3>
                  <button onClick={detectLocation} disabled={isDetectingLocation} className={`text-[10px] font-bold px-3 py-1 rounded-full border transition-all ${isDetectingLocation ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 animate-pulse' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-indigo-400'}`}>
                    {isDetectingLocation ? 'AI ADDRESS LOOKUP...' : 'DETECT MY GPS'}
                  </button>
                </div>
                <div className="space-y-2">
                  <input type="text" value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Address: Street, City..." className="w-full bg-slate-950/50 border border-white/5 rounded-xl p-4 text-slate-300 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500/50" />
                  {locationGrounding?.url && (
                    <a href={locationGrounding.url} target="_blank" rel="noopener noreferrer" className="text-[9px] text-indigo-400 hover:underline flex items-center gap-1 ml-2 font-bold uppercase tracking-widest">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      {locationGrounding.title || 'Verified via Google Search'}
                    </a>
                  )}
                </div>
              </div>
            </div>

            <div className="glass-morphism p-6 rounded-3xl border border-white/10 flex flex-col h-full bg-slate-900/40">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-300 text-xs uppercase tracking-widest">Voice Description</h3>
                {isTranscribing && <span className="text-[10px] font-bold text-indigo-400 animate-pulse uppercase tracking-widest">AI Transcribing...</span>}
              </div>
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Describe the hazard (e.g., oil spill on Main St) or use Voice..." className="w-full flex-1 bg-slate-950/50 border border-white/5 rounded-2xl p-5 text-slate-300 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-pink-500/50 resize-none text-sm mb-4 leading-relaxed" />
              <div className="relative">
                {isRecording && (
                  <div className="absolute -top-12 left-0 right-0 flex justify-center items-center gap-1">
                    {[...Array(6)].map((_, i) => <div key={i} className="w-1.5 bg-indigo-500 rounded-full transition-all duration-75" style={{ height: `${Math.max(4, audioLevel * 140 * (0.8 + Math.random() * 0.4))}px` }} />)}
                  </div>
                )}
                <button onClick={isRecording ? stopRecording : startRecording} disabled={hasMicrophone === false || isTranscribing} className={`w-full flex items-center justify-center gap-3 py-4 rounded-2xl border transition-all font-bold uppercase tracking-widest text-xs ${isRecording ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse' : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30'}`}>
                  <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-ping' : 'bg-indigo-500'}`} />
                  {isRecording ? 'Stop Recording' : isTranscribing ? 'Processing Audio...' : 'Tap to Record Description'}
                </button>
              </div>
              {audioError && <p className="text-red-400 text-xs mt-2">{audioError}</p>}
            </div>
          </div>

          <button disabled={!image || isProcessing || !locationText} onClick={submitReport} className="w-full py-5 rounded-2xl font-bold text-xl funky-gradient disabled:opacity-30 disabled:grayscale transition-all shadow-2xl shadow-purple-900/20 uppercase tracking-widest text-white">
            {isProcessing ? 'Submitting Report...' : 'Log Hazard with Municipal AI'}
          </button>
        </div>
      ) : (
        <div className="glass-morphism p-10 rounded-[2.5rem] border border-green-500/30 text-center animate-in zoom-in duration-300">
          <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto border-2 border-green-500/40 mb-6"><svg className="w-12 h-12 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
          <h3 className="text-4xl font-bangers text-green-400 mb-2 uppercase tracking-widest">Ticket Logged</h3>
          <p className="text-slate-400 font-mono text-xs mb-6">REF: {reportResult.referenceNumber}</p>
          <div className="p-6 bg-slate-900/80 rounded-3xl text-left border border-white/5 mb-8">
            <p className="text-slate-100 italic leading-relaxed">"{reportResult.acknowledgmentMessage || 'Your report has been received and is being processed.'}"</p>
          </div>
          <button onClick={() => setReportResult(null)} className="px-12 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl font-bold uppercase text-sm tracking-widest shadow-xl transition-all">Done</button>
        </div>
      )}
    </div>
  );
};

export default HazardReporting;
