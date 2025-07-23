import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Smile, Paperclip, Phone, Video, MoreVertical, ArrowLeft, Users, Search, Star, Reply, Forward, Copy, Trash2, Download, Play, Pause, Mic, MicOff } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Textarea } from './ui/textarea'
import EmojiPicker from 'emoji-picker-react'
import { useDropzone } from 'react-dropzone'
import { blink } from '../blink/client'

interface User {
  id: string
  displayName: string
  email: string
  avatarUrl?: string
  isOnline: boolean
  lastSeen: number
}

interface Message {
  id: string
  chatId: string
  senderId: string
  content: string
  messageType: 'text' | 'image' | 'video' | 'audio' | 'document'
  fileUrl?: string
  fileName?: string
  fileSize?: number
  replyToMessageId?: string
  isForwarded: boolean
  isStarred: boolean
  createdAt: number
  sender?: User
  replyToMessage?: Message
}

interface Chat {
  id: string
  name?: string
  type: 'individual' | 'group'
  avatarUrl?: string
  participants?: User[]
  isOnline?: boolean
  lastSeen?: number
}

interface ChatAreaProps {
  currentUser: User | null
  selectedChatId: string | null
  onBack: () => void
}

export function ChatArea({ currentUser, selectedChatId, onBack }: ChatAreaProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [chat, setChat] = useState<Chat | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
  const [audioChunks, setAudioChunks] = useState<Blob[]>([])
  
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const loadChat = useCallback(async () => {
    if (!selectedChatId || !currentUser) return

    try {
      const chatData = await blink.db.chats.list({
        where: { id: selectedChatId },
        limit: 1
      })

      if (chatData.length === 0) return

      const chatInfo = chatData[0]
      let chatName = chatInfo.name
      let avatarUrl = chatInfo.avatarUrl
      let isOnline = false
      let lastSeen = 0

      // Get participants
      const participants = await blink.db.chatParticipants.list({
        where: { chatId: selectedChatId }
      })

      const participantUsers = await Promise.all(
        participants.map(async (p) => {
          const user = await blink.db.users.list({
            where: { id: p.userId },
            limit: 1
          })
          return user[0]
        })
      )

      // For individual chats, get the other user's info
      if (chatInfo.type === 'individual') {
        const otherUser = participantUsers.find(u => u.id !== currentUser.id)
        if (otherUser) {
          chatName = otherUser.displayName
          avatarUrl = otherUser.avatarUrl
          isOnline = Number(otherUser.isOnline) > 0
          lastSeen = otherUser.lastSeen || 0
        }
      }

      setChat({
        id: chatInfo.id,
        name: chatName,
        type: chatInfo.type,
        avatarUrl,
        participants: participantUsers,
        isOnline,
        lastSeen
      })
    } catch (error) {
      console.error('Error loading chat:', error)
    }
  }, [selectedChatId, currentUser])

  const loadMessages = useCallback(async () => {
    if (!selectedChatId) return

    try {
      const chatMessages = await blink.db.messages.list({
        where: { chatId: selectedChatId },
        orderBy: { createdAt: 'asc' }
      })

      const messagesWithSenders = await Promise.all(
        chatMessages.map(async (message) => {
          const sender = await blink.db.users.list({
            where: { id: message.senderId },
            limit: 1
          })

          let replyToMessage = null
          if (message.replyToMessageId) {
            const replyMsg = await blink.db.messages.list({
              where: { id: message.replyToMessageId },
              limit: 1
            })
            if (replyMsg.length > 0) {
              const replySender = await blink.db.users.list({
                where: { id: replyMsg[0].senderId },
                limit: 1
              })
              replyToMessage = {
                ...replyMsg[0],
                sender: replySender[0]
              }
            }
          }

          return {
            ...message,
            sender: sender[0],
            replyToMessage,
            isForwarded: Number(message.isForwarded) > 0,
            isStarred: Number(message.isStarred) > 0
          }
        })
      )

      setMessages(messagesWithSenders)
      setTimeout(scrollToBottom, 100)
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }, [selectedChatId])

  useEffect(() => {
    loadChat()
    loadMessages()
  }, [loadChat, loadMessages])

  const sendMessage = async () => {
    if (!newMessage.trim() || !selectedChatId || !currentUser) return

    const messageId = `msg_${Date.now()}`
    const now = Date.now()

    try {
      // Optimistic update
      const optimisticMessage: Message = {
        id: messageId,
        chatId: selectedChatId,
        senderId: currentUser.id,
        content: newMessage,
        messageType: 'text',
        replyToMessageId: replyToMessage?.id,
        isForwarded: false,
        isStarred: false,
        createdAt: now,
        sender: currentUser,
        replyToMessage
      }

      setMessages(prev => [...prev, optimisticMessage])
      setNewMessage('')
      setReplyToMessage(null)
      scrollToBottom()

      // Save to database
      await blink.db.messages.create({
        id: messageId,
        chatId: selectedChatId,
        senderId: currentUser.id,
        content: newMessage,
        messageType: 'text',
        replyToMessageId: replyToMessage?.id,
        isForwarded: false,
        isStarred: false,
        createdAt: now,
        updatedAt: now
      })

      // Update chat's last message time
      await blink.db.chats.update(selectedChatId, {
        lastMessageAt: now,
        updatedAt: now
      })

    } catch (error) {
      console.error('Error sending message:', error)
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== messageId))
    }
  }

  const handleFileUpload = async (files: File[]) => {
    if (!selectedChatId || !currentUser) return

    for (const file of files) {
      try {
        // Upload file to storage
        const { publicUrl } = await blink.storage.upload(
          file,
          `chat-files/${selectedChatId}/${Date.now()}_${file.name}`,
          { upsert: true }
        )

        const messageId = `msg_${Date.now()}_${Math.random()}`
        const now = Date.now()

        let messageType: 'image' | 'video' | 'audio' | 'document' = 'document'
        if (file.type.startsWith('image/')) messageType = 'image'
        else if (file.type.startsWith('video/')) messageType = 'video'
        else if (file.type.startsWith('audio/')) messageType = 'audio'

        // Create message
        await blink.db.messages.create({
          id: messageId,
          chatId: selectedChatId,
          senderId: currentUser.id,
          content: file.name,
          messageType,
          fileUrl: publicUrl,
          fileName: file.name,
          fileSize: file.size,
          isForwarded: false,
          isStarred: false,
          createdAt: now,
          updatedAt: now
        })

        loadMessages()
      } catch (error) {
        console.error('Error uploading file:', error)
      }
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileUpload,
    noClick: true
  })

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      
      recorder.ondataavailable = (event) => {
        setAudioChunks(prev => [...prev, event.data])
      }

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' })
        
        // Upload audio file
        const { publicUrl } = await blink.storage.upload(
          audioBlob,
          `voice-messages/${selectedChatId}/${Date.now()}.wav`,
          { upsert: true }
        )

        const messageId = `msg_${Date.now()}`
        const now = Date.now()

        await blink.db.messages.create({
          id: messageId,
          chatId: selectedChatId!,
          senderId: currentUser!.id,
          content: `Voice message (${recordingTime}s)`,
          messageType: 'audio',
          fileUrl: publicUrl,
          fileName: `voice_${now}.wav`,
          fileSize: audioBlob.size,
          isForwarded: false,
          isStarred: false,
          createdAt: now,
          updatedAt: now
        })

        loadMessages()
        setAudioChunks([])
        setRecordingTime(0)
      }

      recorder.start()
      setMediaRecorder(recorder)
      setIsRecording(true)

      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1)
      }, 1000)

    } catch (error) {
      console.error('Error starting recording:', error)
    }
  }

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop()
      mediaRecorder.stream.getTracks().forEach(track => track.stop())
      setMediaRecorder(null)
      setIsRecording(false)
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

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

  const handleMessageAction = async (action: string, message: Message) => {
    switch (action) {
      case 'reply':
        setReplyToMessage(message)
        break
      case 'star':
        await blink.db.messages.update(message.id, {
          isStarred: !message.isStarred
        })
        loadMessages()
        break
      case 'copy':
        navigator.clipboard.writeText(message.content)
        break
      case 'delete':
        await blink.db.messages.delete(message.id)
        loadMessages()
        break
      case 'download':
        if (message.fileUrl) {
          window.open(message.fileUrl, '_blank')
        }
        break
    }
    setSelectedMessage(null)
  }

  if (!selectedChatId || !chat) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-64 h-64 mx-auto mb-8 opacity-20">
            <svg viewBox="0 0 303 172" className="w-full h-full">
              <defs>
                <linearGradient id="a" x1="50%" x2="50%" y1="100%" y2="0%">
                  <stop offset="0%" stopColor="#25D366" stopOpacity=".05"/>
                  <stop offset="100%" stopColor="#25D366" stopOpacity=".3"/>
                </linearGradient>
              </defs>
              <path fill="url(#a)" d="M229.221 12.579c-56.208-16.255-118.034-16.255-174.242 0C26.52 21.906 4.726 47.521 4.726 76.949v18.102c0 29.428 21.794 55.043 50.253 64.37 56.208 16.255 118.034 16.255 174.242 0 28.459-9.327 50.253-34.942 50.253-64.37V76.949c0-29.428-21.794-55.043-50.253-64.37z"/>
            </svg>
          </div>
          <h2 className="text-2xl font-light text-gray-600 mb-2">WhatsApp Web</h2>
          <p className="text-gray-500 max-w-md">
            Send and receive messages without keeping your phone online.
            Use WhatsApp on up to 4 linked devices and 1 phone at the same time.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div {...getRootProps()} className="flex-1 flex flex-col bg-gray-50 relative">
      {isDragActive && (
        <div className="absolute inset-0 bg-whatsapp-primary/20 border-2 border-dashed border-whatsapp-primary z-50 flex items-center justify-center">
          <div className="text-center">
            <Paperclip className="h-12 w-12 text-whatsapp-primary mx-auto mb-4" />
            <p className="text-lg font-medium text-whatsapp-primary">Drop files here to send</p>
          </div>
        </div>
      )}

      {/* Chat Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Button variant="ghost" size="sm" className="md:hidden" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="relative">
              <Avatar className="h-10 w-10">
                <AvatarImage src={chat.avatarUrl} />
                <AvatarFallback className="bg-gray-200">
                  {chat.type === 'group' ? (
                    <Users className="h-5 w-5 text-gray-600" />
                  ) : (
                    chat.name?.charAt(0) || 'U'
                  )}
                </AvatarFallback>
              </Avatar>
              {chat.type === 'individual' && chat.isOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
              )}
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{chat.name}</h2>
              <p className="text-sm text-gray-500">
                {chat.type === 'group' ? (
                  `${chat.participants?.length || 0} participants`
                ) : chat.isOnline ? (
                  'Online'
                ) : (
                  `Last seen ${formatLastSeen(chat.lastSeen || 0)}`
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="sm">
              <Search className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Phone className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Video className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex ${message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs lg:max-w-md ${message.senderId === currentUser?.id ? 'order-2' : 'order-1'}`}>
                {message.replyToMessage && (
                  <div className="mb-1 p-2 bg-gray-100 rounded-t-lg border-l-4 border-whatsapp-primary">
                    <p className="text-xs font-medium text-whatsapp-primary">
                      {message.replyToMessage.sender?.displayName}
                    </p>
                    <p className="text-sm text-gray-600 truncate">
                      {message.replyToMessage.content}
                    </p>
                  </div>
                )}
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <div
                      className={`p-3 rounded-lg cursor-pointer ${
                        message.senderId === currentUser?.id
                          ? 'bg-whatsapp-primary text-white'
                          : 'bg-white text-gray-900'
                      } shadow-sm hover:shadow-md transition-shadow`}
                    >
                      {message.messageType === 'image' && message.fileUrl && (
                        <div className="mb-2">
                          <img
                            src={message.fileUrl}
                            alt={message.fileName}
                            className="max-w-full h-auto rounded-lg"
                          />
                        </div>
                      )}
                      
                      {message.messageType === 'video' && message.fileUrl && (
                        <div className="mb-2">
                          <video
                            src={message.fileUrl}
                            controls
                            className="max-w-full h-auto rounded-lg"
                          />
                        </div>
                      )}
                      
                      {message.messageType === 'audio' && message.fileUrl && (
                        <div className="mb-2 flex items-center space-x-2">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0">
                            <Play className="h-4 w-4" />
                          </Button>
                          <div className="flex-1 h-1 bg-gray-300 rounded-full">
                            <div className="h-1 bg-current rounded-full w-0"></div>
                          </div>
                          <span className="text-xs">0:00</span>
                        </div>
                      )}
                      
                      {message.messageType === 'document' && (
                        <div className="mb-2 flex items-center space-x-2 p-2 bg-black/10 rounded">
                          <Paperclip className="h-4 w-4" />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{message.fileName}</p>
                            {message.fileSize && (
                              <p className="text-xs opacity-70">{formatFileSize(message.fileSize)}</p>
                            )}
                          </div>
                          <Button size="sm" variant="ghost" className="h-6 w-6 p-0">
                            <Download className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      
                      <p className="text-sm">{message.content}</p>
                      
                      <div className="flex items-center justify-between mt-1">
                        <div className="flex items-center space-x-1">
                          {message.isForwarded && (
                            <Forward className="h-3 w-3 opacity-70" />
                          )}
                          {message.isStarred && (
                            <Star className="h-3 w-3 fill-current opacity-70" />
                          )}
                        </div>
                        <span className={`text-xs ${message.senderId === currentUser?.id ? 'text-white/70' : 'text-gray-500'}`}>
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                      </div>
                    </div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => handleMessageAction('reply', message)}>
                      <Reply className="h-4 w-4 mr-2" />
                      Reply
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleMessageAction('star', message)}>
                      <Star className="h-4 w-4 mr-2" />
                      {message.isStarred ? 'Unstar' : 'Star'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleMessageAction('copy', message)}>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy
                    </DropdownMenuItem>
                    {message.fileUrl && (
                      <DropdownMenuItem onClick={() => handleMessageAction('download', message)}>
                        <Download className="h-4 w-4 mr-2" />
                        Download
                      </DropdownMenuItem>
                    )}
                    {message.senderId === currentUser?.id && (
                      <DropdownMenuItem onClick={() => handleMessageAction('delete', message)} className="text-red-600">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                
                {chat.type === 'group' && message.senderId !== currentUser?.id && (
                  <p className="text-xs text-gray-500 mt-1 ml-3">
                    {message.sender?.displayName}
                  </p>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Reply Preview */}
      {replyToMessage && (
        <div className="bg-gray-100 border-t border-gray-200 p-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-whatsapp-primary">
                Replying to {replyToMessage.sender?.displayName}
              </p>
              <p className="text-sm text-gray-600 truncate">{replyToMessage.content}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReplyToMessage(null)}
            >
              ×
            </Button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex items-end space-x-2">
          <div className="flex space-x-1">
            <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-10 w-10 p-0">
                  <Smile className="h-5 w-5 text-gray-500" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" side="top">
                <EmojiPicker
                  onEmojiClick={(emojiData) => {
                    setNewMessage(prev => prev + emojiData.emoji)
                    setShowEmojiPicker(false)
                  }}
                />
              </PopoverContent>
            </Popover>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  handleFileUpload(Array.from(e.target.files))
                }
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-10 p-0"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-5 w-5 text-gray-500" />
            </Button>
          </div>

          <div className="flex-1">
            {isRecording ? (
              <div className="flex items-center space-x-2 bg-red-50 border border-red-200 rounded-full px-4 py-2">
                <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-red-600">Recording... {recordingTime}s</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={stopRecording}
                  className="h-8 w-8 p-0 text-red-600"
                >
                  <MicOff className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Textarea
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendMessage()
                  }
                }}
                className="min-h-[40px] max-h-32 resize-none border-gray-300 rounded-full px-4 py-2"
                rows={1}
              />
            )}
          </div>

          <div className="flex space-x-1">
            {newMessage.trim() ? (
              <Button
                onClick={sendMessage}
                className="h-10 w-10 p-0 bg-whatsapp-primary hover:bg-whatsapp-accent rounded-full"
              >
                <Send className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0"
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
              >
                <Mic className="h-5 w-5 text-gray-500" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}