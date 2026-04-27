import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { User } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, collection, addDoc, serverTimestamp, query, orderBy, limit, arrayRemove, deleteField, arrayUnion } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import Peer from 'peerjs';
import { Mic, MicOff, Video, VideoOff, Hand, MessageSquare, Users, Copy, Send, Paperclip, MonitorUp, PhoneOff, Clock, X, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';

// Video Tile Component
const VideoTile = ({ stream, isLocal, name, isMuted, isVideoOn, isHandRaised }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="group relative flex h-full w-full min-h-[160px] flex-col items-center justify-center overflow-hidden rounded-3xl bg-gray-200 dark:bg-gray-900 shadow-2xl transition-all border border-gray-300 dark:border-white/5">
      {isVideoOn || isLocal ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-gray-300 to-gray-200 dark:from-gray-800 dark:to-gray-900 border border-gray-300 dark:border-white/5">
           <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white dark:bg-gray-700 shadow-inner">
             <span className="text-3xl font-bold uppercase tracking-wider text-gray-500 dark:text-gray-300">
               {name ? name.charAt(0) : '?'}
             </span>
           </div>
        </div>
      )}
      
      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-xl bg-white/80 dark:bg-black/50 px-3 py-1.5 text-xs font-medium text-gray-900 dark:text-white backdrop-blur-md border border-gray-200 dark:border-white/10 shadow-sm">
        {isMuted && <MicOff className="h-3.5 w-3.5 text-red-500" />}
        {name} {isLocal && '(You)'}
      </div>

      <AnimatePresence>
        {isHandRaised && (
          <motion.initial initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute top-4 right-4 rounded-xl bg-yellow-500 px-3 py-3 text-white shadow-xl shadow-yellow-500/20">
            <Hand className="h-5 w-5 animate-pulse" />
          </motion.initial>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function ChatRoom({ user }: { user: User }) {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  
  const [room, setRoom] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myPeerId, setMyPeerId] = useState<string>('');
  
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<{[peerId: string]: MediaStream}>({});
  const peersRef = useRef<{[peerId: string]: any}>({});
  
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  
  const [tab, setTab] = useState<'chat' | 'people' | null>(null);
  const [toasts, setToasts] = useState<any[]>([]);
  const tabRef = useRef(tab);
  
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  // Request media on mount
  useEffect(() => {
    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { width: { ideal: 1280 }, height: { ideal: 720 } }, 
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
        });
        setLocalStream(stream);
      } catch (err: any) {
        console.error('Failed to get local stream', err);
        
        // Show informative error as a toast instead of an alert
        const errorMsg = err.name === 'NotAllowedError' || err.message?.includes('Permission') || err.message?.includes('denied')
          ? 'Camera/Microphone permission denied. Joining without media.'
          : 'No camera or microphone found. Joining without media.';
          
        setToasts(prev => [...prev, { id: 'media-err', text: errorMsg, senderId: 'system' }]);
        
        // Disable by default if we failed
        setAudioEnabled(false);
        setVideoEnabled(false);

        // Create a dummy stream so PeerJS can still establish WebRTC and receive incoming media
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 640;
            canvas.height = 480;
            const dummyStream = 'captureStream' in canvas ? (canvas as any).captureStream() : new MediaStream();
            setLocalStream(dummyStream);
        } catch (e) {
            setLocalStream(new MediaStream());
        }
      }
    };
    initMedia();
    
    return () => {
      localStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Initialize Room & Messages
  useEffect(() => {
    if (!roomId) return;

    const roomRef = doc(db, 'rooms', roomId);
    // Use estimate to get a local timestamp before server acks to prevent null errors initially
    const unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data({ serverTimestamps: 'estimate' });
        setRoom(data);
      } else {
        navigate('/');
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, `rooms/${roomId}`));

    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'asc'), limit(100));
    const unsubscribeMessages = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);

      // Handle toasts for new messages when chat is closed
      if (tabRef.current !== 'chat') {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            // Don't toast our own messages or old messages during initial fetch
            if (data.senderId !== user.uid && !snapshot.metadata.fromCache) {
               const newToast = { id: change.doc.id, text: data.text || 'Shared a file', senderId: data.senderId };
               setToasts(prev => [...prev, newToast]);
               setTimeout(() => {
                 setToasts(prev => prev.filter(t => t.id !== change.doc.id));
               }, 5000);
            }
          }
        });
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, `rooms/${roomId}/messages`));

    return () => {
      unsubscribeRoom();
      unsubscribeMessages();
    };
  }, [roomId, navigate]);

  // Handle session timeout based on expiresAt
  useEffect(() => {
    if (!room?.expiresAt) return;

    const interval = setInterval(() => {
       const now = new Date().getTime();
       const remaining = Math.max(0, room.expiresAt - now);
       setTimeLeft(remaining);

       if (remaining === 0) {
          clearInterval(interval);
          alert("Session timeout reached. You will now be disconnected.");
          leaveRoom();
       }
    }, 1000);

    return () => clearInterval(interval);
  }, [room?.expiresAt]);

  // Format time
  const formatTime = (ms: number | null) => {
    if (ms === null) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Initialize PeerJS
  useEffect(() => {
    if (!localStream) return;
    
    const newPeer = new Peer();
    
    newPeer.on('open', async (id) => {
      setMyPeerId(id);
      setPeer(newPeer);
      
      if (roomId) {
        await updateDoc(doc(db, 'rooms', roomId), {
          [`peerIds.${user.uid}`]: id
        });
      }
    });

    return () => {
      newPeer.destroy();
    };
  }, [localStream, roomId, user.uid]);

  // Handle incoming calls
  useEffect(() => {
    if (!peer) return;
    
    const handleCall = (call: any) => {
       if (localStreamRef.current) {
         call.answer(localStreamRef.current);
         peersRef.current[call.peer] = call;

         call.on('stream', (stream: MediaStream) => {
            setRemoteStreams(prev => ({...prev, [call.peer]: stream}));
         });
         call.on('close', () => {
            setRemoteStreams(prev => {
               const newer = {...prev};
               delete newer[call.peer];
               return newer;
            });
            delete peersRef.current[call.peer];
         });
       }
    };
    
    peer.on('call', handleCall);
    return () => {
       peer.off('call', handleCall);
    };
  }, [peer]);

  // Call new peers deterministically
  useEffect(() => {
    if (!peer || !myPeerId || !room?.peerIds) return;

    Object.entries(room.peerIds).forEach(([uid, pid]) => {
      if (uid === user.uid || !pid) return; // Skip self or empty
      if (typeof pid !== 'string') return;
      if (peersRef.current[pid]) return; // Already connected

      // Deterministic: only the larger peerId initiates the call to avoid duplicate connections
      if (myPeerId > pid && localStreamRef.current) {
         const call = peer.call(pid, localStreamRef.current);
         if (call) {
             peersRef.current[pid] = call;
             call.on('stream', (stream: MediaStream) => {
                 setRemoteStreams(prev => ({...prev, [pid]: stream}));
             });
             call.on('close', () => {
                 setRemoteStreams(prev => {
                     const newer = {...prev};
                     delete newer[pid];
                     return newer;
                 });
                 delete peersRef.current[pid];
             });
         }
      }
    });
  }, [room?.peerIds, peer, myPeerId, user.uid]);

  // Mute/Video Controls
  const toggleAudio = async () => {
    if (localStream) {
      const enabled = !audioEnabled;
      localStream.getAudioTracks().forEach(t => t.enabled = enabled);
      setAudioEnabled(enabled);
      if (roomId) {
        await updateDoc(doc(db, 'rooms', roomId), {
          [`states.${user.uid}.audio`]: enabled
        });
      }
    }
  };

  const toggleVideo = async () => {
    if (localStream) {
      const enabled = !videoEnabled;
      localStream.getVideoTracks().forEach(t => t.enabled = enabled);
      setVideoEnabled(enabled);
      if (roomId) {
        await updateDoc(doc(db, 'rooms', roomId), {
          [`states.${user.uid}.video`]: enabled
        });
      }
    }
  };

  const toggleHand = async () => {
    if (!roomId) return;
    const isRaised = !isHandRaised;
    setIsHandRaised(isRaised);
    
    const roomRef = doc(db, 'rooms', roomId);
    if (isRaised) {
      const currentHands = room?.raisedHands || [];
      await updateDoc(roomRef, { raisedHands: [...new Set([...currentHands, user.uid])] });
    } else {
      await updateDoc(roomRef, { raisedHands: arrayRemove(user.uid) });
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        
        videoTrack.onended = stopScreenShare;
        
        Object.values(peersRef.current).forEach(call => {
          const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(videoTrack);
        });
        
        setLocalStream(prev => {
          if (!prev) return null;
          const newStream = new MediaStream([videoTrack, ...prev.getAudioTracks()]);
          return newStream;
        });
        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (err) {
       console.error('Failed to share screen', err);
    }
  };

  const stopScreenShare = () => {
    navigator.mediaDevices.getUserMedia({ video: true }).then(cameraStream => {
      const videoTrack = cameraStream.getVideoTracks()[0];
      
      Object.values(peersRef.current).forEach(call => {
        const sender = call.peerConnection?.getSenders().find((s: any) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });
      
      setLocalStream(prev => {
        if (!prev) return null;
        const newStream = new MediaStream([videoTrack, ...prev.getAudioTracks()]);
        // transfer enabled state
        newStream.getVideoTracks().forEach(t => t.enabled = videoEnabled);
        return newStream;
      });
      setIsScreenSharing(false);
    });
  };

  const leaveRoom = async () => {
    localStream?.getTracks().forEach(t => t.stop());
    Object.values(peersRef.current).forEach(c => c.close());
    peer?.destroy();
    
    if (roomId) {
       try {
         await updateDoc(doc(db, 'rooms', roomId), {
            participants: arrayRemove(user.uid),
            [`peerIds.${user.uid}`]: deleteField(),
            raisedHands: arrayRemove(user.uid)
         });
       } catch (e) {}
    }
    navigate('/');
  };

  // Messaging / Files
  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newMessage.trim() || !roomId) return;
    const msgText = newMessage.trim();
    setNewMessage('');
    try {
      await addDoc(collection(db, 'rooms', roomId, 'messages'), {
        senderId: user.uid,
        text: msgText,
        type: 'text',
        createdAt: serverTimestamp()
      });
    } catch (err) {}
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !roomId) return;
    if (file.size > 800 * 1024) {
      alert('File is too large. Please select a file under 800KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      await addDoc(collection(db, 'rooms', roomId, 'messages'), {
        senderId: user.uid,
        fileData: base64,
        type: 'file',
        fileName: file.name,
        createdAt: serverTimestamp()
      });
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copyCode = () => {
    const link = `https://uxbysourav.github.io/echo-meet/#/room/${roomId}`;
    navigator.clipboard.writeText(link);
    alert('Invite Link copied!\n\n' + link);
  };

  const increaseSessionTime = async () => {
    if (!roomId || !room?.expiresAt) return;
    try {
      await updateDoc(doc(db, 'rooms', roomId), {
        expiresAt: room.expiresAt + 15 * 60 * 1000 // add 15 mins
      });
      alert('Added 15 minutes to session!');
    } catch (err) {
      console.error('Cannot update time', err);
    }
  };

  // Grid layout helper
  const totalVideos = Object.keys(remoteStreams).length + 1;
  const getGridCols = (count: number) => {
    if (count === 1) return 'grid-cols-1 md:grid-cols-1';
    if (count <= 2) return 'grid-cols-1 sm:grid-cols-2 lg:px-20 xl:px-40';
    if (count <= 4) return 'grid-cols-2';
    if (count <= 6) return 'grid-cols-2 lg:grid-cols-3';
    if (count <= 9) return 'grid-cols-2 sm:grid-cols-3';
    if (count <= 16) return 'grid-cols-3 sm:grid-cols-4';
    return 'grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8';
  };

  // UID resolution for Remote Streams
  const resolveUid = (pId: string) => {
    for (const [uid, pid] of Object.entries(room?.peerIds || {})) {
      if (pid === pId) return uid;
    }
    return 'unknown';
  };

  const [joinName, setJoinName] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinDirectly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !user) return;
    setIsJoining(true);
    try {
      const profileName = joinName.trim() || user.displayName || user.email?.split('@')[0] || `Guest ${Math.floor(Math.random() * 1000)}`;
      
      await updateDoc(doc(db, 'rooms', roomId), {
        participants: arrayUnion(user.uid),
        [`profiles.${user.uid}`]: { name: profileName, photo: user.photoURL || '' },
        [`states.${user.uid}`]: { audio: audioEnabled, video: videoEnabled }
      });
    } catch (err: any) {
      console.error("Could not join directly", err);
    } finally {
      setIsJoining(false);
    }
  };

  if (!room) return (
    <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white transition-colors duration-300">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
        <p className="text-gray-500 dark:text-gray-400 font-medium">Entering meeting...</p>
      </div>
    </div>
  );

  const isParticipant = room.participants?.includes(user.uid);

  if (!isParticipant) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-[#0a0a0a] text-gray-900 dark:text-white transition-colors duration-300 px-4">
        <div className="w-full max-w-sm rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
           <div className="mb-6 flex justify-center">
             <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-inner">
                 <Video className="h-8 w-8 text-white" />
             </div>
           </div>
           <h2 className="mb-2 text-center text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Join Meeting</h2>
           <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">You've been invited to join this room.</p>
           
           <form onSubmit={handleJoinDirectly} className="space-y-4">
              <input
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="Enter your display name (optional)"
                className="w-full rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-black/40 px-4 py-4 text-center text-sm font-medium text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                autoFocus
              />
              <button
                type="submit"
                disabled={isJoining}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-4 font-semibold text-white transition-all hover:bg-blue-500 disabled:opacity-50"
              >
                {isJoining ? 'Joining...' : 'Join Now'}
              </button>
           </form>
        </div>
      </div>
    );
  }

  const myProfile = room.profiles?.[user.uid] || { name: 'You' };
  const isTimeLow = timeLeft !== null && timeLeft <= 300000; // < 5 mins

  return (
    <div className="relative flex h-screen flex-col bg-gray-50 dark:bg-[#0a0a0a] font-sans text-gray-900 dark:text-white overflow-hidden transition-colors duration-300">
      
      {/* Floating Header */}
      <header className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-4 pointer-events-auto">
           <div className="flex items-center gap-3 rounded-2xl bg-white/80 dark:bg-white/5 px-4 py-2.5 backdrop-blur-md shadow-lg border border-gray-200 dark:border-white/10">
              <div className="flex items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 p-1.5 shadow-sm">
                 <Video className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold tracking-tight text-gray-900 dark:text-white hidden sm:block">Echo Meet</span>
              <div className="h-4 w-px bg-gray-300 dark:bg-white/15 hidden sm:block"></div>
              <button onClick={copyCode} className="group flex items-center gap-2 rounded-lg bg-gray-100 dark:bg-white/5 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 transition-colors hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white" title="Copy Meeting Code">
                <span className="font-mono tracking-wider">{roomId}</span>
                <Copy className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100 transition-opacity" />
              </button>
           </div>
        </div>

        {/* Floating Timer */}
        <div className="flex items-center gap-4 pointer-events-auto">
           <div className={clsx(
              "flex items-center gap-2 rounded-2xl px-4 py-2.5 backdrop-blur-md shadow-lg border transition-colors",
              isTimeLow ? "bg-red-500/20 border-red-500/30 text-red-500 dark:text-red-400" : "bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300"
           )}>
              <Clock className={clsx("h-4 w-4", isTimeLow && "animate-pulse")} />
              <div className="flex flex-col">
                 <span className="text-xs font-medium leading-none opacity-80 mb-0.5">Session Ends</span>
                 <span className={clsx("font-mono font-bold tracking-wider leading-none", isTimeLow ? "text-red-600 dark:text-red-400" : "text-gray-900 dark:text-white")}>
                    {formatTime(timeLeft)}
                 </span>
              </div>
           </div>
           
           {/* Admin extend time button */}
           {room.createdBy === user.uid && (
             <button
               onClick={increaseSessionTime}
               className="flex items-center gap-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 text-xs font-bold transition-colors shadow-lg"
               title="Add 15 minutes"
             >
               <Plus className="h-4 w-4" /> 15m
             </button>
           )}
        </div>
      </header>

      {/* Main Grid Content */}
      <div className="flex flex-1 overflow-hidden pt-24 pb-28 px-4 md:px-8">
        <div className={clsx("flex-1 transition-all h-full", tab ? "md:pr-4 md:w-[calc(100%-340px)] hidden md:block" : "w-full")}>
           <div className={clsx("grid gap-4 h-full w-full auto-rows-[1fr] place-content-center", getGridCols(totalVideos))}>
               {/* Local Video */}
               <VideoTile 
                  stream={localStream} 
                  isLocal={true} 
                  name={myProfile.name} 
                  isMuted={!audioEnabled} 
                  isVideoOn={videoEnabled || isScreenSharing} 
                  isHandRaised={isHandRaised} 
               />
               {/* Remote Videos */}
               {Object.entries(remoteStreams).map(([peerId, stream]) => {
                  const uid = resolveUid(peerId);
                  const profile = room.profiles?.[uid] || { name: 'Unknown' };
                  const state = room.states?.[uid] || { audio: true, video: true };
                  const isRaised = room.raisedHands?.includes(uid);
                  
                  return (
                    <VideoTile 
                      key={peerId} 
                      stream={stream} 
                      name={profile.name} 
                      isMuted={!state.audio} 
                      isVideoOn={state.video} 
                      isHandRaised={isRaised} 
                    />
                  );
               })}
           </div>
        </div>

        {/* Sleek Side Panel */}
        <AnimatePresence>
          {tab && (
             <motion.div 
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="absolute right-0 top-0 h-full w-full md:relative md:h-full md:w-[340px] md:rounded-3xl bg-white/90 dark:bg-gray-900/80 backdrop-blur-xl border-l md:border border-gray-200 dark:border-white/10 flex flex-col z-30 shadow-2xl overflow-hidden"
             >
                <div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-white/5">
                   <h3 className="font-bold text-gray-900 dark:text-white tracking-tight">{tab === 'chat' ? 'Meeting Chat' : 'Participants'}</h3>
                   <button onClick={() => setTab(null)} className="rounded-full p-2 bg-gray-200 dark:bg-black/20 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-300 dark:hover:bg-black/40 hover:text-gray-900 dark:hover:text-white">
                      <X className="w-5 h-5" />
                   </button>
                </div>

                {tab === 'chat' && (
                  <>
                    <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
                      {messages.length === 0 && (
                         <div className="flex h-full items-center justify-center text-center">
                            <div className="text-gray-400 dark:text-gray-500">
                               <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-20" />
                               <p className="text-sm">No messages yet.<br/>Start the conversation!</p>
                            </div>
                         </div>
                      )}
                      {messages.map((msg) => {
                         const isMe = msg.senderId === user.uid;
                         const senderProfile = room.profiles?.[msg.senderId] || { name: 'Unknown' };
                         return (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={msg.id} className={clsx("flex flex-col", isMe ? "items-end" : "items-start")}>
                               <span className="text-[11px] font-medium text-gray-500 mb-1.5 px-1 uppercase tracking-wider">{isMe ? 'You' : senderProfile.name}</span>
                               <div className={clsx("max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm", isMe ? "bg-blue-600 text-white rounded-tr-sm" : "bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-100 rounded-tl-sm border border-gray-200 dark:border-white/5")}>
                                  {msg.type === 'text' && <p className="text-sm leading-relaxed break-words">{msg.text}</p>}
                                  {msg.type === 'file' && (
                                     <a href={msg.fileData} download={msg.fileName} className="flex items-center gap-2 text-sm font-medium hover:underline break-words">
                                        <Paperclip className="h-4 w-4 shrink-0 opacity-70" />
                                        <span className="truncate">{msg.fileName}</span>
                                     </a>
                                  )}
                               </div>
                            </motion.div>
                         );
                      })}
                      <div ref={messagesEndRef} />
                    </div>
                    <div className="p-4 border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-black/20">
                       <form onSubmit={sendMessage} className="flex gap-2">
                          <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
                          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex shrink-0 items-center justify-center rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-transparent p-3.5 text-gray-500 dark:text-gray-400 transition-colors hover:bg-gray-100 dark:hover:bg-white/10 dark:hover:text-white">
                             <Paperclip className="h-5 w-5" />
                          </button>
                          <input
                             type="text"
                             value={newMessage}
                             onChange={(e) => setNewMessage(e.target.value)}
                             placeholder="Type message..."
                             className="flex-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-black/40 px-4 py-3 text-sm text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 shadow-inner focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <button type="submit" disabled={!newMessage.trim()} className="flex shrink-0 items-center justify-center rounded-xl bg-blue-600 p-3.5 text-white shadow-lg shadow-blue-900/20 transition-all hover:bg-blue-500 disabled:opacity-50 disabled:shadow-none">
                             <Send className="h-5 w-5" />
                          </button>
                       </form>
                    </div>
                  </>
                )}

                {tab === 'people' && (
                  <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                     {room.participants.map((uid: string) => {
                        const profile = room.profiles?.[uid] || { name: 'Unknown' };
                        const state = room.states?.[uid] || { audio: true, video: true };
                        const isRaised = room.raisedHands?.includes(uid);
                        return (
                           <div key={uid} className="flex items-center justify-between p-3 transition-colors hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl">
                              <div className="flex items-center gap-3">
                                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-blue-50 dark:from-gray-700 dark:to-gray-600 text-blue-600 dark:text-gray-100 text-sm font-bold uppercase tracking-wider shadow-inner">
                                    {profile.name.charAt(0)}
                                 </div>
                                 <span className="text-sm font-medium text-gray-900 dark:text-white">{profile.name} {uid === user.uid && <span className="text-gray-400 dark:text-gray-500 text-xs ml-1">(You)</span>}</span>
                              </div>
                              <div className="flex items-center gap-2.5">
                                 {isRaised && <Hand className="w-4 h-4 text-yellow-500" />}
                                 <div className={clsx("flex h-8 w-8 items-center justify-center rounded-full", state.video ? "bg-gray-200 dark:bg-white/5 text-gray-600 dark:text-gray-300" : "bg-red-100 dark:bg-red-500/10 text-red-500 dark:text-red-400")}>
                                   {state.video ? <Video className="w-3.5 h-3.5" /> : <VideoOff className="w-3.5 h-3.5" />}
                                 </div>
                                 <div className={clsx("flex h-8 w-8 items-center justify-center rounded-full", state.audio ? "bg-gray-200 dark:bg-white/5 text-gray-600 dark:text-gray-300" : "bg-red-100 dark:bg-red-500/10 text-red-500 dark:text-red-400")}>
                                   {state.audio ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                                 </div>
                              </div>
                           </div>
                        );
                     })}
                  </div>
                )}
             </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Toast Notifications */}
      <div className="absolute top-24 right-4 z-50 flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => {
             const senderProfile = room.profiles?.[toast.senderId] || { name: 'Unknown' };
             return (
               <motion.div 
                 key={toast.id}
                 initial={{ opacity: 0, x: 50, scale: 0.9 }}
                 animate={{ opacity: 1, x: 0, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
                 className="bg-white/90 dark:bg-gray-900/90 backdrop-blur-md border border-gray-200 dark:border-white/10 p-4 rounded-2xl shadow-2xl flex flex-col min-w-[250px] max-w-[300px] pointer-events-auto transition-colors"
               >
                 <div className="flex items-center gap-2 mb-1">
                   <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold uppercase tracking-wider text-white">
                      {senderProfile.name.charAt(0)}
                   </div>
                   <span className="text-sm font-semibold text-gray-900 dark:text-gray-200">{senderProfile.name}</span>
                 </div>
                 <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">{toast.text}</p>
               </motion.div>
             );
          })}
        </AnimatePresence>
      </div>

      {/* Floating Bottom Controls (Island) */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40">
        <div className="flex items-center gap-2 sm:gap-3 rounded-3xl bg-white/80 dark:bg-white/5 border border-gray-200 dark:border-white/10 px-4 py-3 backdrop-blur-xl shadow-2xl transition-colors">
           <button onClick={toggleAudio} className={clsx("flex w-12 h-12 sm:w-14 sm:h-14 items-center justify-center rounded-full transition-all duration-300 shadow-sm", audioEnabled ? "bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-white/20" : "bg-red-500 text-white hover:bg-red-600")}>
              {audioEnabled ? <Mic className="w-5 h-5 sm:w-6 sm:h-6" /> : <MicOff className="w-5 h-5 sm:w-6 sm:h-6" />}
           </button>

           <button onClick={toggleVideo} className={clsx("flex w-12 h-12 sm:w-14 sm:h-14 items-center justify-center rounded-full transition-all duration-300 shadow-sm", videoEnabled ? "bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-white/20" : "bg-red-500 text-white hover:bg-red-600")}>
              {videoEnabled ? <Video className="w-5 h-5 sm:w-6 sm:h-6" /> : <VideoOff className="w-5 h-5 sm:w-6 sm:h-6" />}
           </button>

           <button onClick={toggleScreenShare} className={clsx("flex w-12 h-12 sm:w-14 sm:h-14 items-center justify-center rounded-full transition-all duration-300 shadow-sm hidden sm:flex", isScreenSharing ? "bg-blue-500 text-white" : "bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-white/20")}>
              <MonitorUp className="w-5 h-5 sm:w-6 sm:h-6" />
           </button>

           <button onClick={toggleHand} className={clsx("flex w-12 h-12 sm:w-14 sm:h-14 items-center justify-center rounded-full transition-all duration-300 shadow-sm", isHandRaised ? "bg-yellow-500 text-white shadow-yellow-500/20" : "bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white hover:bg-gray-300 dark:hover:bg-white/20")}>
              <Hand className="w-5 h-5 sm:w-6 sm:h-6" />
           </button>
           
           <div className="w-px h-10 bg-gray-300 dark:bg-white/10 mx-1 sm:mx-2"></div>
           
           <button onClick={() => setTab(tab === 'people' ? null : 'people')} className={clsx("flex h-12 sm:h-14 items-center justify-center px-4 sm:px-5 rounded-full transition-colors font-medium", tab === 'people' ? "bg-gray-300 dark:bg-white/20 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300")}>
              <span className="flex items-center gap-2">
                 <Users className="w-5 h-5" />
                 <span>{room.participants.length}</span>
              </span>
           </button>

           <button onClick={() => setTab(tab === 'chat' ? null : 'chat')} className={clsx("flex w-12 h-12 sm:w-14 sm:h-14 items-center justify-center rounded-full transition-colors", tab === 'chat' ? "bg-gray-300 dark:bg-white/20 text-gray-900 dark:text-white" : "bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300")}>
              <MessageSquare className="w-5 h-5" />
           </button>

           <div className="w-px h-10 bg-gray-300 dark:bg-white/10 mx-1 sm:mx-2"></div>
           
           <button onClick={leaveRoom} className="flex h-12 sm:h-14 items-center gap-2 px-5 sm:px-6 rounded-full bg-red-600 hover:bg-red-500 text-white font-bold transition-colors shadow-lg shadow-red-600/20">
              <PhoneOff className="w-5 h-5" />
              <span className="hidden sm:block">Leave</span>
           </button>
        </div>
      </div>

    </div>
  );
}
