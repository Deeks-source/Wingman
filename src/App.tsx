import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { 
  Send, 
  Feather, 
  Save, 
  Sparkles, 
  Palette, 
  Loader2, 
  User, 
  Heart,
  History,
  Menu,
  X
} from 'lucide-react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc
} from 'firebase/firestore';
import { db, auth } from './lib/firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { ChatMessage, UserProfile, BasicProfile } from './types';
import { sendMessage, extractAnalysis, USER_EXTRACTION_PROMPT, PARTNER_EXTRACTION_PROMPT } from './services/geminiService';

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [basicProfile, setBasicProfile] = useState<BasicProfile | null>(null);
  const [isProfileFormVisible, setIsProfileFormVisible] = useState(false);
  const [profileForm, setProfileForm] = useState<BasicProfile>({ name: '', age: '', gender: '', pronouns: '' });
  const [summary, setSummary] = useState<string>('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const SESSION_ID = currentUser ? currentUser.uid : 'default-session';
  const USER_ID = currentUser ? currentUser.uid : 'default-user';

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthLoaded(true);
    });
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!db || !isAuthLoaded) return;
    // Listen for messages from Firestore
    const q = query(
      collection(db, 'sessions', SESSION_ID, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatMessage[];
      setMessages(msgs);
    });

    // Load session metadata (like summary)
    const loadSessionData = async () => {
      const sessionDoc = await getDoc(doc(db, 'sessions', SESSION_ID));
      if (sessionDoc.exists()) {
        setSummary(sessionDoc.data().summary || '');
      } else {
        setSummary('');
      }
    };
    loadSessionData();

    // Load profile
    const loadProfile = async () => {
      const profileDoc = await getDoc(doc(db, 'users', USER_ID, 'profiles', 'current'));
      if (profileDoc.exists()) {
        setUserProfile(profileDoc.data() as UserProfile);
      } else {
        setUserProfile(null);
      }
      const basicDoc = await getDoc(doc(db, 'users', USER_ID, 'profiles', 'basic'));
      if (basicDoc.exists()) {
        setBasicProfile(basicDoc.data() as BasicProfile);
      } else {
        setBasicProfile(null);
      }
    };
    loadProfile();

    return () => unsubscribe();
  }, [currentUser, isAuthLoaded, SESSION_ID, USER_ID]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Sign in failed", error);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setMessages([]);
      setSummary('');
      setUserProfile(null);
      setBasicProfile(null);
      setInput('');
      setIsProfileFormVisible(false);
    } catch (error) {
      console.error("Sign out failed", error);
    }
  };

  const migrateGuestData = async () => {
    if (!currentUser) return;
    setIsLoading(true);
    try {
      const oldMessagesQ = query(collection(db, 'sessions', 'default-session', 'messages'), orderBy('timestamp', 'asc'));
      const oldMessagesSnapshot = await getDocs(oldMessagesQ);
      
      if (!oldMessagesSnapshot.empty) {
        for (const docSnap of oldMessagesSnapshot.docs) {
          await setDoc(doc(db, 'sessions', currentUser.uid, 'messages', docSnap.id), docSnap.data());
        }
      }
      
      const oldSessionDoc = await getDoc(doc(db, 'sessions', 'default-session'));
      if (oldSessionDoc.exists()) {
        await setDoc(doc(db, 'sessions', currentUser.uid), oldSessionDoc.data());
        setSummary(oldSessionDoc.data().summary || '');
      }
      
      const oldCurrentProfile = await getDoc(doc(db, 'users', 'default-user', 'profiles', 'current'));
      if (oldCurrentProfile.exists()) {
        await setDoc(doc(db, 'users', currentUser.uid, 'profiles', 'current'), oldCurrentProfile.data());
        setUserProfile(oldCurrentProfile.data() as UserProfile);
      }
      
      const oldBasicProfile = await getDoc(doc(db, 'users', 'default-user', 'profiles', 'basic'));
      if (oldBasicProfile.exists()) {
        await setDoc(doc(db, 'users', currentUser.uid, 'profiles', 'basic'), oldBasicProfile.data());
        setBasicProfile(oldBasicProfile.data() as BasicProfile);
      }
      
      alert("Guest data successfully imported to your account!");
    } catch(error) {
      console.error("Migration failed", error);
      alert("Failed to migrate guest data.");
    }
    setIsLoading(false);
  };

  const handleSend = async (initialText?: string) => {
    const textToSubmit = initialText || input;
    if (!textToSubmit.trim() || isLoading) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsLoading(true);

    try {
      // 1. Create temporary message for history context
      const currentMessage: ChatMessage = {
        id: 'temp-' + Date.now(),
        role: 'user',
        text: textToSubmit,
        timestamp: Date.now(),
      };

      // 2. Save user message to Firestore
      await addDoc(collection(db, 'sessions', SESSION_ID, 'messages'), {
        role: currentMessage.role,
        text: currentMessage.text,
        timestamp: currentMessage.timestamp,
      });

      // 3. Get AI response with summary - passing the current message in the context
      const response = await sendMessage([...messages, currentMessage], textToSubmit, summary, basicProfile || undefined);

      // 4. Save AI response to Firestore
      await addDoc(collection(db, 'sessions', SESSION_ID, 'messages'), {
        role: 'model',
        text: response,
        timestamp: Date.now(),
      });

      // 5. Automatic summarization if history is long (every 10 messages after first 15)
      // Only summarize if it's an even number of messages to avoid frequent calls
      if (messages.length > 15 && messages.length % 6 === 0) {
        import('./services/geminiService').then(async ({ summarizeConversation }) => {
          const newSummary = await summarizeConversation([...messages, currentMessage]);
          setSummary(newSummary);
          await setDoc(doc(db, 'sessions', SESSION_ID), { summary: newSummary }, { merge: true });
        });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    try {
      const result = await extractAnalysis(messages, 'Please analyze our conversation so far and provide an updated version of my profile analysis in JSON format.');
      setUserProfile(result);
      // Save profile to Firestore
      await setDoc(doc(db, 'users', USER_ID, 'profiles', 'current'), result);
    } catch (error) {
      console.error(error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="flex h-screen bg-[#FDFBF7] text-[#1A1A1A] overflow-hidden font-sans">
      {/* Main Conversation Area */}
      <main className="flex-1 flex flex-col relative bg-transparent overflow-hidden">
        {/* Background Grain/Canvas effect */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[url('https://www.transparenttextures.com/patterns/canvas-orange.png')]" />

        {/* Header content */}
        <header className="px-4 md:px-12 py-6 border-b border-[#1A1A1A]/5 flex justify-between items-center bg-[#FDFBF7]/60 backdrop-blur-lg sticky top-0 z-40">
          <div className="flex items-center gap-4 md:gap-6 max-w-5xl mx-auto w-full">
            <div className="w-10 h-10 md:w-12 md:h-12 shrink-0 bg-[#1A1A1A] text-[#FDFBF7] flex items-center justify-center rounded-full shadow-2xl relative group overflow-hidden">
              <Feather size={20} className="relative z-10 group-hover:rotate-45 transition-transform duration-500" />
              <div className="absolute inset-0 bg-gradient-to-tr from-[#C5A059] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <div className="truncate">
              <h1 className="font-serif text-xl md:text-3xl tracking-tight text-[#1A1A1A] truncate">Wingman Atelier</h1>
              <p className="text-[9px] md:text-[10px] font-black text-[#1A1A1A]/30 uppercase tracking-[0.4em] truncate">Personal Dating Curator</p>
            </div>
            
            <div className="ml-auto flex items-center gap-3 md:gap-6 shrink-0">
              {currentUser ? (
                <div className="flex items-center gap-3">
                  <div className="hidden sm:flex flex-col items-end">
                    <span className="text-xs font-serif text-[#1A1A1A] truncate max-w-[120px]">{currentUser.displayName || 'User'}</span>
                    <button onClick={handleSignOut} className="text-[9px] uppercase tracking-[0.2em] text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors font-black">Sign Out</button>
                  </div>
                  {currentUser.photoURL ? (
                    <img onClick={() => { if(window.innerWidth < 640) handleSignOut(); }} src={currentUser.photoURL} alt="Profile" className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-[#1A1A1A]/20 cursor-pointer sm:cursor-default" title="Tap to sign out on mobile" />
                  ) : (
                    <div onClick={() => { if(window.innerWidth < 640) handleSignOut(); }} className="w-8 h-8 md:w-10 md:h-10 bg-[#1A1A1A]/5 rounded-full flex items-center justify-center cursor-pointer sm:cursor-default" title="Tap to sign out on mobile">
                      <User size={16} className="text-[#1A1A1A]/40" />
                    </div>
                  )}
                </div>
              ) : (
                <button onClick={handleSignIn} className="px-4 md:px-6 py-2.5 md:py-3 bg-[#1A1A1A] text-[#FDFBF7] transition-all font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 rounded-sm hover:-translate-y-0.5 shadow-md active:translate-y-0 shrink-0">
                  <User size={14} className="md:hidden" />
                  <span className="hidden md:inline">Sign In</span>
                </button>
              )}

              <button 
                onClick={runAnalysis}
                disabled={isAnalyzing || messages.length < 5}
                className="px-3 md:px-6 py-2.5 md:py-3 border border-[#1A1A1A]/10 hover:bg-[#1A1A1A] hover:text-[#FDFBF7] transition-all font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] flex items-center gap-2 md:gap-3 rounded-sm disabled:opacity-20 shadow-sm hover:shadow-xl active:scale-95 shrink-0"
              >
                {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                <span className="hidden md:inline">Archive Soul</span>
              </button>

              {currentUser && (
                <button 
                  onClick={migrateGuestData}
                  disabled={isLoading}
                  className="flex px-3 md:px-4 py-2.5 md:py-3 border border-[#1A1A1A]/10 hover:bg-[#1A1A1A]/5 transition-all font-black text-[9px] md:text-[10px] uppercase tracking-[0.2em] items-center gap-2 md:gap-3 rounded-sm disabled:opacity-20 shadow-sm active:scale-95 shrink-0 text-[#1A1A1A]/50 hover:text-[#1A1A1A]"
                  title="Import your chats from before you signed in"
                >
                  <span className="md:hidden">Import</span>
                  <span className="hidden md:inline">Import Guest History</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Chat Messages */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 md:px-0 py-12 space-y-12 scroll-smooth customize-scrollbar relative z-10"
        >
          <div className="max-w-3xl mx-auto space-y-12">
            {messages.length === 0 && (
              <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center space-y-10 group">
                <div className="w-24 h-24 bg-[#F2EFE9] border border-[#C5A059]/10 rounded-full flex items-center justify-center shadow-inner group-hover:border-[#C5A059]/30 transition-all duration-700">
                  <Sparkles className="text-[#C5A059]" size={40} strokeWidth={1.5} />
                </div>
                <div className="space-y-4">
                  <h2 className="font-serif text-5xl text-[#1A1A1A] tracking-tighter">Your atelier awaits.</h2>
                  <p className="text-[#1A1A1A]/40 italic font-serif text-lg leading-relaxed max-w-md mx-auto">
                    "Every conversation is a brushstroke. Tell me about your journey, your dreams, and what makes your heart beat faster."
                  </p>
                </div>

                {!isProfileFormVisible && !basicProfile && (
                  <button 
                    onClick={() => setIsProfileFormVisible(true)}
                    className="group relative px-12 py-4 overflow-hidden border border-[#1A1A1A] hover:border-[#1A1A1A] focus:outline-none transition-all duration-300"
                  >
                    <div className="absolute inset-0 w-0 bg-[#1A1A1A] transition-all duration-[400ms] ease-out group-hover:w-full" />
                    <span className="relative z-10 text-[10px] font-black uppercase tracking-[0.4em] text-[#1A1A1A] group-hover:text-[#FDFBF7] transition-colors">
                      Set Basic Profile
                    </span>
                  </button>
                )}

                {isProfileFormVisible && !basicProfile && (
                  <div className="max-w-md w-full space-y-4 bg-[#F2EFE9]/50 p-8 border border-[#1A1A1A]/5 shadow-xl text-left animate-in fade-in slide-in-from-bottom-4 duration-500 rounded-sm">
                    <h3 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#1A1A1A]/40 mb-6 text-center">The Essentials</h3>
                    <input 
                      type="text" placeholder="Name" 
                      value={profileForm.name} onChange={e => setProfileForm({...profileForm, name: e.target.value})}
                      className="w-full border-b border-[#1A1A1A]/20 bg-transparent px-0 py-3 outline-none focus:border-[#C5A059] transition-colors font-serif text-xl placeholder-[#1A1A1A]/20"
                    />
                    <input 
                      type="text" placeholder="Age" 
                      value={profileForm.age} onChange={e => setProfileForm({...profileForm, age: e.target.value})}
                      className="w-full border-b border-[#1A1A1A]/20 bg-transparent px-0 py-3 outline-none focus:border-[#C5A059] transition-colors font-serif text-xl placeholder-[#1A1A1A]/20"
                    />
                    <div className="flex gap-4">
                      <input 
                        type="text" placeholder="Gender" 
                        value={profileForm.gender} onChange={e => setProfileForm({...profileForm, gender: e.target.value})}
                        className="w-full border-b border-[#1A1A1A]/20 bg-transparent px-0 py-3 outline-none focus:border-[#C5A059] transition-colors font-serif text-xl placeholder-[#1A1A1A]/20"
                      />
                      <input 
                        type="text" placeholder="Pronouns" 
                        value={profileForm.pronouns} onChange={e => setProfileForm({...profileForm, pronouns: e.target.value})}
                        className="w-full border-b border-[#1A1A1A]/20 bg-transparent px-0 py-3 outline-none focus:border-[#C5A059] transition-colors font-serif text-xl placeholder-[#1A1A1A]/20"
                      />
                    </div>
                    <button 
                      onClick={async () => {
                        setIsLoading(true);
                        setBasicProfile(profileForm);
                        await setDoc(doc(db, 'users', USER_ID, 'profiles', 'basic'), profileForm);
                        setIsLoading(false);
                      }}
                      disabled={!profileForm.name}
                      className="w-full bg-[#1A1A1A] text-[#FDFBF7] py-4 mt-8 text-[10px] uppercase font-black tracking-[0.4em] hover:bg-[#C5A059] transition-colors disabled:opacity-50 disabled:hover:bg-[#1A1A1A]"
                    >
                      Save & Continue
                    </button>
                  </div>
                )}

                {basicProfile && (
                  <button 
                    onClick={() => handleSend("Tell me about yourself and how you can help me find love.")}
                    className="group relative px-12 py-4 overflow-hidden border border-[#1A1A1A] hover:border-[#1A1A1A] focus:outline-none transition-all duration-300 animate-in fade-in"
                  >
                    <div className="absolute inset-0 w-0 bg-[#1A1A1A] transition-all duration-[400ms] ease-out group-hover:w-full" />
                    <span className="relative z-10 text-[10px] font-black uppercase tracking-[0.4em] text-[#1A1A1A] group-hover:text-[#FDFBF7] transition-colors">
                      Begin the Dialogue
                    </span>
                  </button>
                )}
              </div>
            )}

            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[90%] md:max-w-[85%] group ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                  <span className={`block text-[10px] font-black uppercase tracking-[0.3em] mb-3 ${msg.role === 'user' ? 'text-[#C5A059]' : 'text-[#1A1A1A]/20'}`}>
                    {msg.role === 'user' ? 'The Subject' : 'The Curator'}
                  </span>
                  
                  <div className={`
                    relative p-6 md:p-8 text-lg md:text-xl font-serif leading-relaxed shadow-lg transition-all duration-500 break-words overflow-hidden
                    ${msg.role === 'user' 
                      ? 'bg-[#1A1A1A] text-[#FDFBF7] rounded-[2px] rounded-tl-[24px]' 
                      : 'bg-white text-[#1A1A1A] border border-[#1A1A1A]/5 rounded-[2px] rounded-tr-[24px]'}
                  `}>
                    <div className="markdown-body">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  </div>
                  
                  <span className="block mt-3 text-[10px] text-[#1A1A1A]/10 font-bold uppercase tracking-[0.2em] group-hover:text-[#1A1A1A]/30 transition-colors">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </motion.div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="flex gap-3 p-6 bg-white/40 rounded-sm backdrop-blur-sm border border-[#1A1A1A]/5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -6, 0], opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }}
                      className="w-2 h-2 bg-[#1A1A1A]/30 rounded-full"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-8 bg-[#FDFBF7]/90 backdrop-blur-2xl border-t border-[#1A1A1A]/5 z-40 relative">
          <div className="max-w-4xl mx-auto w-full">
            <div className="relative flex items-end gap-4 bg-white border border-[#1A1A1A]/10 rounded-2xl px-6 py-4 shadow-xl focus-within:ring-2 focus-within:ring-[#C5A059]/20 transition-all duration-500">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Paint your thoughts..."
                className="flex-1 bg-transparent outline-none font-serif text-lg md:text-xl text-[#1A1A1A] placeholder-[#1A1A1A]/20 resize-none max-h-[200px] overflow-y-auto leading-relaxed pt-1"
                rows={1}
              />
              <button 
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading}
                className={`p-3 rounded-full transition-all duration-500 shrink-0 mb-1 ${
                  input.trim() && !isLoading
                  ? 'bg-[#1A1A1A] text-[#FDFBF7] shadow-lg hover:bg-[#C5A059] scale-105 active:scale-95' 
                  : 'bg-[#1A1A1A]/5 text-[#1A1A1A]/10 cursor-not-allowed'
                }`}
              >
                <Send size={24} />
              </button>
            </div>
            
            <div className="flex justify-between items-center mt-4 px-4">
              <p className="text-[10px] text-[#1A1A1A]/20 font-black tracking-[0.4em] uppercase">
                Fine Art Logic • Gemini 3.0
              </p>
              {userProfile && (
                <div className="flex items-center gap-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
                  <span className="text-[10px] uppercase font-black tracking-widest text-[#C5A059] flex items-center gap-2">
                    <User size={12} />
                    Profile Synced
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&family=Inter:wght@400;700;900&display=swap');
        
        .font-serif { font-family: 'Playfair Display', serif; }
        .font-sans { font-family: 'Inter', sans-serif; }

        .customize-scrollbar::-webkit-scrollbar { width: 5px; }
        .customize-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .customize-scrollbar::-webkit-scrollbar-thumb { background: rgba(26, 26, 26, 0.04); border-radius: 10px; }
        .customize-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(26, 26, 26, 0.1); }

        .markdown-body {
          word-wrap: break-word;
          overflow-wrap: break-word;
          max-width: 100%;
        }
        .markdown-body p { margin-bottom: 1.25rem; }
        .markdown-body p:last-child { margin-bottom: 0; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 1.25rem; padding-left: 1.5rem; }
        .markdown-body li { margin-bottom: 0.5rem; list-style-type: disc; }
        .markdown-body strong { font-weight: 900; color: inherit; }
        .markdown-body pre { 
          background: rgba(0,0,0,0.03); 
          padding: 1rem; 
          border-radius: 4px; 
          overflow-x: auto; 
          font-family: monospace; 
          font-size: 0.85em;
          margin-bottom: 1.25rem;
        }
        .markdown-body code {
          font-family: monospace;
          background: rgba(0,0,0,0.05);
          padding: 0.2em 0.4em;
          border-radius: 3px;
          font-size: 0.9em;
        }
        .markdown-body h1, .markdown-body h2, .markdown-body h3 {
          font-weight: 900;
          margin-top: 1.5rem;
          margin-bottom: 1rem;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
}
