import React, { useState, useEffect, useCallback } from 'react'
import { ChatSidebar } from './components/ChatSidebar'
import { ChatArea } from './components/ChatArea'
import { Stories } from './components/Stories'
import { Button } from './components/ui/button'
import { blink } from './blink/client'

interface User {
  id: string
  displayName: string
  email: string
  avatarUrl?: string
  phoneNumber?: string
  statusMessage?: string
  isOnline: boolean
  lastSeen: number
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showMobileSidebar, setShowMobileSidebar] = useState(true)

  const initializeUser = useCallback(async (authUser: any) => {
    try {
      // Check if user exists in database
      const existingUsers = await blink.db.users.list({
        where: { email: authUser.email },
        limit: 1
      })

      let user: User
      if (existingUsers.length > 0) {
        // Update existing user's online status
        await blink.db.users.update(existingUsers[0].id, {
          isOnline: true,
          lastSeen: Date.now()
        })

        user = {
          id: existingUsers[0].id,
          displayName: existingUsers[0].displayName,
          email: existingUsers[0].email,
          avatarUrl: existingUsers[0].avatarUrl,
          phoneNumber: existingUsers[0].phoneNumber,
          statusMessage: existingUsers[0].statusMessage,
          isOnline: true,
          lastSeen: Date.now()
        }
      } else {
        // Create new user
        const userId = `user_${Date.now()}`
        const newUser = {
          id: userId,
          email: authUser.email,
          displayName: authUser.displayName || authUser.email.split('@')[0],
          avatarUrl: authUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${authUser.email}`,
          phoneNumber: '',
          statusMessage: 'Hey there! I am using WhatsApp.',
          isOnline: true,
          lastSeen: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now()
        }

        await blink.db.users.create(newUser)

        user = {
          id: newUser.id,
          displayName: newUser.displayName,
          email: newUser.email,
          avatarUrl: newUser.avatarUrl,
          phoneNumber: newUser.phoneNumber,
          statusMessage: newUser.statusMessage,
          isOnline: true,
          lastSeen: newUser.lastSeen
        }
      }

      setCurrentUser(user)
    } catch (error) {
      console.error('Error initializing user:', error)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = blink.auth.onAuthStateChanged((state) => {
      if (state.user) {
        initializeUser(state.user)
      } else {
        setCurrentUser(null)
      }
      setIsLoading(state.isLoading)
    })
    return unsubscribe
  }, [initializeUser])

  const handleChatSelect = (chatId: string) => {
    setSelectedChatId(chatId)
    setShowMobileSidebar(false)
  }

  const handleNewChat = async (userId: string) => {
    if (!currentUser) return

    try {
      const chatId = `chat_${Date.now()}`
      
      // Create new chat
      await blink.db.chats.create({
        id: chatId,
        name: null,
        type: 'individual',
        avatarUrl: null,
        createdBy: currentUser.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessageAt: 0
      })

      // Add participants
      await blink.db.chatParticipants.create({
        id: `cp_${chatId}_${currentUser.id}`,
        chatId,
        userId: currentUser.id,
        joinedAt: Date.now()
      })

      await blink.db.chatParticipants.create({
        id: `cp_${chatId}_${userId}`,
        chatId,
        userId,
        joinedAt: Date.now()
      })

      setSelectedChatId(chatId)
      setShowMobileSidebar(false)
    } catch (error) {
      console.error('Error creating new chat:', error)
    }
  }

  const handleBack = () => {
    setShowMobileSidebar(true)
    setSelectedChatId(null)
  }

  // Update user's last seen when app is about to close
  useEffect(() => {
    const handleBeforeUnload = async () => {
      if (currentUser) {
        await blink.db.users.update(currentUser.id, {
          isOnline: false,
          lastSeen: Date.now()
        })
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [currentUser])

  // Periodically update last seen
  useEffect(() => {
    if (!currentUser) return

    const interval = setInterval(async () => {
      try {
        await blink.db.users.update(currentUser.id, {
          lastSeen: Date.now()
        })
      } catch (error) {
        console.error('Error updating last seen:', error)
      }
    }, 30000) // Update every 30 seconds

    return () => clearInterval(interval)
  }, [currentUser])

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-whatsapp-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading WhatsApp...</p>
        </div>
      </div>
    )
  }

  if (!currentUser) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-whatsapp-primary to-whatsapp-accent">
        <div className="text-center text-white">
          <div className="w-32 h-32 mx-auto mb-8">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="45" fill="white" fillOpacity="0.2"/>
              <path d="M50 15c19.3 0 35 15.7 35 35 0 6.1-1.6 11.8-4.4 16.8L85 75l-8.2-4.4c-5 2.8-10.7 4.4-16.8 4.4-19.3 0-35-15.7-35-35s15.7-35 35-35z" fill="white"/>
              <path d="M73.5 41.5c0-2.5-2-4.5-4.5-4.5s-4.5 2-4.5 4.5 2 4.5 4.5 4.5 4.5-2 4.5-4.5zm-19 0c0-2.5-2-4.5-4.5-4.5s-4.5 2-4.5 4.5 2 4.5 4.5 4.5 4.5-2 4.5-4.5zm-19 0c0-2.5-2-4.5-4.5-4.5s-4.5 2-4.5 4.5 2 4.5 4.5 4.5 4.5-2 4.5-4.5z" fill="#25D366"/>
            </svg>
          </div>
          <h1 className="text-4xl font-light mb-4">WhatsApp Web</h1>
          <p className="text-xl mb-8 opacity-90">Send and receive messages without keeping your phone online</p>
          <Button
            onClick={() => blink.auth.login()}
            className="bg-white text-whatsapp-primary hover:bg-gray-100 px-8 py-3 text-lg font-medium"
          >
            Sign In to Continue
          </Button>
          <p className="text-sm mt-6 opacity-75">
            Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-100 flex flex-col">
      {/* Stories Section */}
      <div className="flex-shrink-0">
        <Stories currentUser={currentUser} />
      </div>

      {/* Main Chat Interface */}
      <div className="flex-1 flex overflow-hidden">
        {/* Mobile: Show sidebar or chat area */}
        <div className="md:hidden w-full">
          {showMobileSidebar ? (
            <ChatSidebar
              currentUser={currentUser}
              selectedChatId={selectedChatId}
              onChatSelect={handleChatSelect}
              onNewChat={handleNewChat}
            />
          ) : (
            <ChatArea
              currentUser={currentUser}
              selectedChatId={selectedChatId}
              onBack={handleBack}
            />
          )}
        </div>

        {/* Desktop: Show both sidebar and chat area */}
        <div className="hidden md:flex w-full">
          <ChatSidebar
            currentUser={currentUser}
            selectedChatId={selectedChatId}
            onChatSelect={handleChatSelect}
            onNewChat={handleNewChat}
          />
          <ChatArea
            currentUser={currentUser}
            selectedChatId={selectedChatId}
            onBack={handleBack}
          />
        </div>
      </div>
    </div>
  )
}

export default App