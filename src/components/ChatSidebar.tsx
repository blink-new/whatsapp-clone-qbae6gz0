import React, { useState, useEffect, useCallback } from 'react'
import { Search, Plus, MoreVertical, Users, Phone, Video, Archive, Settings, MessageSquare, UserPlus, Camera } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import { ScrollArea } from './ui/scroll-area'
import { blink } from '../blink/client'

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

interface Chat {
  id: string
  name?: string
  type: 'individual' | 'group'
  avatarUrl?: string
  lastMessage?: {
    content: string
    senderName: string
    timestamp: number
    messageType: string
  }
  unreadCount?: number
  participants?: User[]
  isOnline?: boolean
  lastSeen?: number
}

interface Call {
  id: string
  callerName: string
  receiverName: string
  callType: 'voice' | 'video'
  status: 'missed' | 'answered' | 'declined'
  duration: number
  startedAt: number
}

interface ChatSidebarProps {
  currentUser: User | null
  selectedChatId: string | null
  onChatSelect: (chatId: string) => void
  onNewChat: (userId: string) => void
}

export function ChatSidebar({ currentUser, selectedChatId, onChatSelect, onNewChat }: ChatSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [chats, setChats] = useState<Chat[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [calls, setCalls] = useState<Call[]>([])
  const [activeTab, setActiveTab] = useState('chats')
  const [showNewChatDialog, setShowNewChatDialog] = useState(false)
  const [showNewGroupDialog, setShowNewGroupDialog] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([])
  const [groupName, setGroupName] = useState('')

  const loadChats = useCallback(async () => {
    if (!currentUser) return

    try {
      // Get all chats for current user
      const userChats = await blink.db.chatParticipants.list({
        where: { userId: currentUser.id },
        orderBy: { joinedAt: 'desc' }
      })

      const chatPromises = userChats.map(async (participant) => {
        const chat = await blink.db.chats.list({
          where: { id: participant.chatId },
          limit: 1
        })

        if (chat.length === 0) return null

        const chatData = chat[0]

        // Get last message
        const lastMessages = await blink.db.messages.list({
          where: { chatId: chatData.id },
          orderBy: { createdAt: 'desc' },
          limit: 1
        })

        let lastMessage = null
        if (lastMessages.length > 0) {
          const msg = lastMessages[0]
          const sender = await blink.db.users.list({
            where: { id: msg.senderId },
            limit: 1
          })
          lastMessage = {
            content: msg.content,
            senderName: sender[0]?.displayName || 'Unknown',
            timestamp: msg.createdAt,
            messageType: msg.messageType || 'text'
          }
        }

        // Get other participants for individual chats
        let chatName = chatData.name
        let avatarUrl = chatData.avatarUrl
        let isOnline = false
        let lastSeen = 0

        if (chatData.type === 'individual') {
          const otherParticipants = await blink.db.chatParticipants.list({
            where: { 
              AND: [
                { chatId: chatData.id },
                { userId: { not: currentUser.id } }
              ]
            }
          })

          if (otherParticipants.length > 0) {
            const otherUser = await blink.db.users.list({
              where: { id: otherParticipants[0].userId },
              limit: 1
            })

            if (otherUser.length > 0) {
              chatName = otherUser[0].displayName
              avatarUrl = otherUser[0].avatarUrl
              isOnline = Number(otherUser[0].isOnline) > 0
              lastSeen = otherUser[0].lastSeen || 0
            }
          }
        }

        return {
          id: chatData.id,
          name: chatName,
          type: chatData.type,
          avatarUrl,
          lastMessage,
          unreadCount: 0,
          isOnline,
          lastSeen
        }
      })

      const resolvedChats = (await Promise.all(chatPromises)).filter(Boolean) as Chat[]
      setChats(resolvedChats)
    } catch (error) {
      console.error('Error loading chats:', error)
    }
  }, [currentUser])

  const loadAllUsers = useCallback(async () => {
    if (!currentUser) return

    try {
      const users = await blink.db.users.list({
        where: { id: { not: currentUser.id } },
        orderBy: { displayName: 'asc' }
      })

      const formattedUsers: User[] = users.map(user => ({
        id: user.id,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        phoneNumber: user.phoneNumber,
        statusMessage: user.statusMessage,
        isOnline: Number(user.isOnline) > 0,
        lastSeen: user.lastSeen || 0
      }))

      setAllUsers(formattedUsers)
    } catch (error) {
      console.error('Error loading users:', error)
    }
  }, [currentUser])

  const loadCalls = useCallback(async () => {
    if (!currentUser) return

    try {
      const userCalls = await blink.db.calls.list({
        where: {
          OR: [
            { callerId: currentUser.id },
            { receiverId: currentUser.id }
          ]
        },
        orderBy: { startedAt: 'desc' },
        limit: 50
      })

      const callPromises = userCalls.map(async (call) => {
        const caller = await blink.db.users.list({
          where: { id: call.callerId },
          limit: 1
        })
        const receiver = await blink.db.users.list({
          where: { id: call.receiverId },
          limit: 1
        })

        return {
          id: call.id,
          callerName: caller[0]?.displayName || 'Unknown',
          receiverName: receiver[0]?.displayName || 'Unknown',
          callType: call.callType as 'voice' | 'video',
          status: call.status as 'missed' | 'answered' | 'declined',
          duration: call.duration || 0,
          startedAt: call.startedAt
        }
      })

      const resolvedCalls = await Promise.all(callPromises)
      setCalls(resolvedCalls)
    } catch (error) {
      console.error('Error loading calls:', error)
    }
  }, [currentUser])

  useEffect(() => {
    loadChats()
    loadAllUsers()
    loadCalls()
  }, [loadChats, loadAllUsers, loadCalls])

  const filteredChats = chats.filter(chat =>
    chat.name?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredUsers = allUsers.filter(user =>
    user.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredCalls = calls.filter(call =>
    call.callerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    call.receiverName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatLastSeen = (timestamp: number) => {
    if (!timestamp) return 'Never'
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  const formatCallDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const handleStartChat = async (userId: string) => {
    try {
      // Check if chat already exists
      const existingChats = await blink.db.chatParticipants.list({
        where: { userId: currentUser!.id }
      })

      for (const participant of existingChats) {
        const otherParticipants = await blink.db.chatParticipants.list({
          where: {
            AND: [
              { chatId: participant.chatId },
              { userId }
            ]
          }
        })

        if (otherParticipants.length > 0) {
          // Chat exists, select it
          onChatSelect(participant.chatId)
          setShowNewChatDialog(false)
          return
        }
      }

      // Create new chat
      onNewChat(userId)
      setShowNewChatDialog(false)
    } catch (error) {
      console.error('Error starting chat:', error)
    }
  }

  const handleCreateGroup = async () => {
    if (!groupName.trim() || selectedUsers.length === 0) return

    try {
      const groupId = `group_${Date.now()}`
      const chatId = `chat_${groupId}`

      // Create group
      await blink.db.groups.create({
        id: groupId,
        name: groupName,
        description: '',
        createdBy: currentUser!.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      // Create chat
      await blink.db.chats.create({
        id: chatId,
        name: groupName,
        type: 'group',
        createdBy: currentUser!.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastMessageAt: Date.now()
      })

      // Add group members
      const allMembers = [currentUser!.id, ...selectedUsers]
      for (const userId of allMembers) {
        await blink.db.groupMembers.create({
          id: `gm_${groupId}_${userId}`,
          groupId,
          userId,
          role: userId === currentUser!.id ? 'admin' : 'member',
          joinedAt: Date.now()
        })

        await blink.db.chatParticipants.create({
          id: `cp_${chatId}_${userId}`,
          chatId,
          userId,
          joinedAt: Date.now()
        })
      }

      // Send welcome message
      await blink.db.messages.create({
        id: `msg_${Date.now()}`,
        chatId,
        senderId: currentUser!.id,
        content: `${currentUser!.displayName} created group "${groupName}"`,
        messageType: 'text',
        createdAt: Date.now(),
        updatedAt: Date.now()
      })

      setShowNewGroupDialog(false)
      setGroupName('')
      setSelectedUsers([])
      loadChats()
      onChatSelect(chatId)
    } catch (error) {
      console.error('Error creating group:', error)
    }
  }

  return (
    <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={currentUser?.avatarUrl} />
              <AvatarFallback className="bg-whatsapp-primary text-white">
                {currentUser?.displayName?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="font-semibold text-gray-900">{currentUser?.displayName}</h2>
              <p className="text-xs text-gray-500">Online</p>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <Dialog open={showNewChatDialog} onOpenChange={setShowNewChatDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <MessageSquare className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Start New Chat</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Search contacts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <ScrollArea className="h-64">
                    <div className="space-y-2">
                      {filteredUsers.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                          onClick={() => handleStartChat(user.id)}
                        >
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={user.avatarUrl} />
                            <AvatarFallback>{user.displayName.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{user.displayName}</p>
                            <p className="text-sm text-gray-500">{user.statusMessage}</p>
                          </div>
                          {user.isOnline && (
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showNewGroupDialog} onOpenChange={setShowNewGroupDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                  <Users className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Create New Group</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Input
                    placeholder="Group name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                  />
                  <div>
                    <p className="text-sm font-medium mb-2">Add participants:</p>
                    <ScrollArea className="h-48">
                      <div className="space-y-2">
                        {allUsers.map((user) => (
                          <div
                            key={user.id}
                            className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer ${
                              selectedUsers.includes(user.id) ? 'bg-whatsapp-primary/10' : 'hover:bg-gray-50'
                            }`}
                            onClick={() => {
                              setSelectedUsers(prev =>
                                prev.includes(user.id)
                                  ? prev.filter(id => id !== user.id)
                                  : [...prev, user.id]
                              )
                            }}
                          >
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={user.avatarUrl} />
                              <AvatarFallback>{user.displayName.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{user.displayName}</p>
                            </div>
                            {selectedUsers.includes(user.id) && (
                              <div className="w-4 h-4 bg-whatsapp-primary rounded-full flex items-center justify-center">
                                <div className="w-2 h-2 bg-white rounded-full"></div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                  <Button
                    onClick={handleCreateGroup}
                    disabled={!groupName.trim() || selectedUsers.length === 0}
                    className="w-full bg-whatsapp-primary hover:bg-whatsapp-accent"
                  >
                    Create Group ({selectedUsers.length} members)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search or start new chat"
            className="pl-10 bg-gray-50 border-none"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-3 bg-gray-50 m-2">
          <TabsTrigger value="chats" className="text-xs">Chats</TabsTrigger>
          <TabsTrigger value="calls" className="text-xs">Calls</TabsTrigger>
          <TabsTrigger value="contacts" className="text-xs">Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="chats" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              {filteredChats.map((chat) => (
                <div
                  key={chat.id}
                  className={`flex items-center space-x-3 p-3 hover:bg-gray-50 cursor-pointer rounded-lg ${
                    selectedChatId === chat.id ? 'bg-gray-100' : ''
                  }`}
                  onClick={() => onChatSelect(chat.id)}
                >
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={chat.avatarUrl} />
                      <AvatarFallback className="bg-gray-200">
                        {chat.type === 'group' ? (
                          <Users className="h-6 w-6 text-gray-600" />
                        ) : (
                          chat.name?.charAt(0) || 'U'
                        )}
                      </AvatarFallback>
                    </Avatar>
                    {chat.type === 'individual' && chat.isOnline && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900 truncate">{chat.name}</h3>
                      {chat.lastMessage && (
                        <span className="text-xs text-gray-500">
                          {new Date(chat.lastMessage.timestamp).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-600 truncate">
                        {chat.lastMessage ? (
                          chat.type === 'group' ? (
                            `${chat.lastMessage.senderName}: ${chat.lastMessage.content}`
                          ) : (
                            chat.lastMessage.content
                          )
                        ) : (
                          chat.type === 'individual' && !chat.isOnline ? (
                            `Last seen ${formatLastSeen(chat.lastSeen || 0)}`
                          ) : (
                            'No messages yet'
                          )
                        )}
                      </p>
                      {chat.unreadCount && chat.unreadCount > 0 && (
                        <Badge className="bg-whatsapp-primary text-white text-xs">
                          {chat.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="calls" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              {filteredCalls.map((call) => (
                <div key={call.id} className="flex items-center space-x-3 p-3 hover:bg-gray-50 rounded-lg">
                  <div className="flex-shrink-0">
                    {call.callType === 'video' ? (
                      <Video className={`h-5 w-5 ${call.status === 'missed' ? 'text-red-500' : 'text-green-500'}`} />
                    ) : (
                      <Phone className={`h-5 w-5 ${call.status === 'missed' ? 'text-red-500' : 'text-green-500'}`} />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {call.callerName === currentUser?.displayName ? call.receiverName : call.callerName}
                    </p>
                    <div className="flex items-center space-x-2 text-sm text-gray-500">
                      <span className={call.status === 'missed' ? 'text-red-500' : ''}>
                        {call.status === 'missed' ? 'Missed' : 
                         call.status === 'answered' ? 'Answered' : 'Declined'}
                      </span>
                      {call.duration > 0 && (
                        <>
                          <span>•</span>
                          <span>{formatCallDuration(call.duration)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(call.startedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="contacts" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-1 p-2">
              {filteredUsers.map((user) => (
                <div
                  key={user.id}
                  className="flex items-center space-x-3 p-3 hover:bg-gray-50 cursor-pointer rounded-lg"
                  onClick={() => handleStartChat(user.id)}
                >
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarImage src={user.avatarUrl} />
                      <AvatarFallback>{user.displayName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    {user.isOnline && (
                      <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{user.displayName}</h3>
                    <p className="text-sm text-gray-600 truncate">{user.statusMessage}</p>
                    {!user.isOnline && (
                      <p className="text-xs text-gray-500">Last seen {formatLastSeen(user.lastSeen)}</p>
                    )}
                  </div>
                  <div className="flex space-x-1">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Phone className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                      <Video className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  )
}