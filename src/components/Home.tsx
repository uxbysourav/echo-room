import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPopup, signInAnonymously, User } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import { auth, googleProvider, db, handleFirestoreError, OperationType } from '../firebase';
import { Plus, LogIn, Users, Info, UserCircle, Video, X, ChevronRight, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import clsx from 'clsx';

export default function Home({ user }: { user: User | null }) {
  const [joinCode, setJoinCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGuestLogin = async () => {
    try {
      await signInAnonymously(auth);
    } catch (err: any) {
      if (err.code === 'auth/operation-not-allowed' || err.code === 'auth/admin-restricted-operation') {
        setError('Anonymous sign-in is disabled. Please enable it in Firebase Console.');
      } else {
        setError(err.message);
      }
    }
  };

  const generateCode = () => {
    return Math.random().toString(36).substring(2, 11).toUpperCase();
  };

  const getUserProfile = (currentUser: User) => ({
    name: customName.trim() || currentUser.displayName || currentUser.email?.split('@')[0] || `Guest ${Math.floor(Math.random() * 1000)}`,
    photo: currentUser.photoURL || ''
  });

  const createRoom = async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    
    const roomId = generateCode();
    try {
      await setDoc(doc(db, 'rooms', roomId), {
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        participants: [user.uid],
        status: 'waiting',
        peerIds: {},
        profiles: {
          [user.uid]: getUserProfile(user)
        },
        states: {
          [user.uid]: { audio: true, video: true }
        },
        raisedHands: []
      });
      navigate(`/room/${roomId}`);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, `rooms/${roomId}`);
      setError(`Failed to create meeting: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !joinCode.trim()) return;
    
    setLoading(true);
    setError('');
    const code = joinCode.trim().toUpperCase();
    
    try {
      const roomRef = doc(db, 'rooms', code);
      const roomSnap = await getDoc(roomRef);
      
      if (!roomSnap.exists()) {
        setError('Meeting not found. Please check the code.');
        setLoading(false);
        return;
      }
      
      const roomData = roomSnap.data();
      
      if (!roomData.participants.includes(user.uid) && roomData.participants.length >= 50) {
        setError('This meeting is full (Max 50 participants).');
        setLoading(false);
        return;
      }

      await setDoc(roomRef, {
        participants: arrayUnion(user.uid),
        [`profiles.${user.uid}`]: getUserProfile(user),
        [`states.${user.uid}`]: { audio: true, video: true }
      }, { merge: true });
      
      navigate(`/room/${code}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `rooms/${code}`);
      setError('Failed to join meeting.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0a0a0a] font-sans text-gray-100">
      {/* Animated Background Gradients */}
      <div className="absolute top-[-20%] left-[-10%] h-[600px] w-[600px] rounded-full bg-blue-600/20 blur-[120px] mix-blend-screen" />
      <div className="absolute bottom-[-20%] right-[-10%] h-[600px] w-[600px] rounded-full bg-purple-600/20 blur-[120px] mix-blend-screen" />

      {/* Top right buttons */}
      <div className="absolute top-6 right-6 z-20 flex gap-3">
        <button 
          onClick={() => setShowInfo(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 border border-white/10 text-gray-300 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white"
        >
          <Info className="h-5 w-5" />
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-2xl backdrop-blur-xl sm:w-[440px]"
      >
        <div className="relative px-8 pt-12 pb-8">
          <motion.div 
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.3 }}
            className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-blue-400 shadow-[0_0_40px_rgba(37,99,235,0.4)]"
          >
            <Video className="h-8 w-8 text-white" />
          </motion.div>
          
          <div className="text-center">
            <h1 className="bg-gradient-to-br from-white to-white/60 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
              Echo Meet
            </h1>
            <p className="mt-3 text-sm font-medium text-blue-400/80 flex items-center justify-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" /> High-quality group calls
            </p>
          </div>

          <div className="mt-8 mb-6">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Enter your display name (optional)"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-center text-sm font-medium text-white placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="mt-4">
            {!user ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="space-y-4 text-center">
                <button
                  onClick={handleLogin}
                  className="group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3.5 font-semibold text-gray-950 transition-all hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <LogIn className="h-5 w-5" />
                  Continue with Google
                  <ChevronRight className="absolute right-4 h-4 w-4 opacity-50 transition-transform group-hover:translate-x-1" />
                </button>

                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <div className="h-px flex-1 bg-white/10"></div>
                  <span>OR</span>
                  <div className="h-px flex-1 bg-white/10"></div>
                </div>

                <button
                  onClick={handleGuestLogin}
                  className="group relative flex w-full items-center justify-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 font-semibold text-white transition-all hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <UserCircle className="h-5 w-5" />
                  Join as Guest
                  <ChevronRight className="absolute right-4 h-4 w-4 opacity-50 transition-transform group-hover:translate-x-1" />
                </button>
              </motion.div>
            ) : (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <button
                    onClick={createRoom}
                    disabled={loading}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-4 font-semibold text-white shadow-lg shadow-blue-900/20 transition-all hover:scale-[1.02] hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:hover:scale-100"
                  >
                    <Plus className="h-5 w-5" />
                    {loading ? 'Starting Meeting...' : 'Start New Meeting'}
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <div className="h-px flex-1 bg-white/10"></div>
                  <span>JOIN EXISTING</span>
                  <div className="h-px flex-1 bg-white/10"></div>
                </div>

                <form onSubmit={joinRoom} className="space-y-3">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="Enter Room Code"
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-4 text-center text-lg font-medium tracking-widest text-white uppercase placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={loading || joinCode.length < 3}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 px-4 py-4 font-semibold text-white transition-all hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10"
                  >
                    <Users className="h-5 w-5" />
                    Join Meeting
                  </button>
                </form>
              </motion.div>
            )}

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0, marginTop: 0 }} 
                  animate={{ opacity: 1, height: 'auto', marginTop: 16 }} 
                  exit={{ opacity: 0, height: 0, marginTop: 0 }}
                  className="overflow-hidden rounded-xl bg-red-500/10 border border-red-500/20 text-center text-sm text-red-400"
                >
                  <div className="px-4 py-3">{error}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showInfo && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-gray-900 p-6 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-bold text-white">About Project</h2>
                <button onClick={() => setShowInfo(false)} className="rounded-full bg-white/5 p-2 text-gray-400 transition-colors hover:bg-white/10 hover:text-white">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="space-y-5 text-gray-300">
                <p className="text-sm leading-relaxed"><strong>Echo Meet</strong> is a high-quality peer-to-peer group video calling platform supporting up to 50 concurrent users.</p>
                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
                  <p className="font-semibold text-blue-300">Sourav Shah</p>
                  <p className="mt-1 text-xs text-blue-400/80 uppercase tracking-widest">MCA Final Year Project</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
