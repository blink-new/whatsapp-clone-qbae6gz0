import React, { useState, useEffect, useCallback } from 'react'
import { Plus, X, Eye, Heart, Reply, Send } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import { Dialog, DialogContent } from './ui/dialog'
import { Input } from './ui/input'
import { ScrollArea } from './ui/scroll-area'
import { Badge } from './ui/badge'
import { blink } from '../blink/client'

interface User {
  id: string
  displayName: string
  avatarUrl?: string
}

interface Story {
  id: string
  userId: string
  contentUrl: string
  contentType: 'image' | 'video'
  caption?: string
  createdAt: number
  expiresAt: number
  user?: User
  views?: StoryView[]
}

interface StoryView {
  id: string
  storyId: string
  viewerId: string
  viewedAt: number
  viewer?: User
}

interface StoriesProps {
  currentUser: User | null
}

export function Stories({ currentUser }: StoriesProps) {
  const [stories, setStories] = useState<Story[]>([])
  const [myStories, setMyStories] = useState<Story[]>([])
  const [selectedStory, setSelectedStory] = useState<Story | null>(null)
  const [currentStoryIndex, setCurrentStoryIndex] = useState(0)
  const [showStoryViewer, setShowStoryViewer] = useState(false)
  const [showAddStory, setShowAddStory] = useState(false)
  const [storyCaption, setStoryCaption] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [storyProgress, setStoryProgress] = useState(0)
  const [storyTimer, setStoryTimer] = useState<NodeJS.Timeout | null>(null)

  const loadStories = useCallback(async () => {
    if (!currentUser) return

    try {
      // Get all active stories (not expired)
      const now = Date.now()
      const activeStories = await blink.db.stories.list({
        where: { expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' }
      })

      // Group stories by user
      const storiesWithUsers = await Promise.all(
        activeStories.map(async (story) => {
          const user = await blink.db.users.list({
            where: { id: story.userId },
            limit: 1
          })

          // Get views for this story
          const views = await blink.db.storyViews.list({
            where: { storyId: story.id }
          })

          const viewsWithUsers = await Promise.all(
            views.map(async (view) => {
              const viewer = await blink.db.users.list({
                where: { id: view.viewerId },
                limit: 1
              })
              return {
                ...view,
                viewer: viewer[0]
              }
            })
          )

          return {
            ...story,
            user: user[0],
            views: viewsWithUsers
          }
        })
      )

      // Separate my stories from others
      const myStoriesList = storiesWithUsers.filter(s => s.userId === currentUser.id)
      const otherStories = storiesWithUsers.filter(s => s.userId !== currentUser.id)

      setMyStories(myStoriesList)
      setStories(otherStories)
    } catch (error) {
      console.error('Error loading stories:', error)
    }
  }, [currentUser])

  useEffect(() => {
    loadStories()
  }, [loadStories])

  const handleAddStory = async () => {
    if (!selectedFile || !currentUser) return

    try {
      // Upload file to storage
      const { publicUrl } = await blink.storage.upload(
        selectedFile,
        `stories/${currentUser.id}/${Date.now()}_${selectedFile.name}`,
        { upsert: true }
      )

      const storyId = `story_${Date.now()}`
      const now = Date.now()
      const expiresAt = now + (24 * 60 * 60 * 1000) // 24 hours

      // Create story
      await blink.db.stories.create({
        id: storyId,
        userId: currentUser.id,
        contentUrl: publicUrl,
        contentType: selectedFile.type.startsWith('video/') ? 'video' : 'image',
        caption: storyCaption,
        createdAt: now,
        expiresAt
      })

      setShowAddStory(false)
      setSelectedFile(null)
      setStoryCaption('')
      loadStories()
    } catch (error) {
      console.error('Error adding story:', error)
    }
  }

  const handleViewStory = async (story: Story, index: number) => {
    setSelectedStory(story)
    setCurrentStoryIndex(index)
    setShowStoryViewer(true)
    setStoryProgress(0)

    // Mark as viewed if not own story
    if (story.userId !== currentUser?.id) {
      try {
        // Check if already viewed
        const existingView = await blink.db.storyViews.list({
          where: {
            AND: [
              { storyId: story.id },
              { viewerId: currentUser!.id }
            ]
          }
        })

        if (existingView.length === 0) {
          await blink.db.storyViews.create({
            id: `view_${Date.now()}`,
            storyId: story.id,
            viewerId: currentUser!.id,
            viewedAt: Date.now()
          })
        }
      } catch (error) {
        console.error('Error marking story as viewed:', error)
      }
    }

    // Start story timer
    const timer = setInterval(() => {
      setStoryProgress(prev => {
        if (prev >= 100) {
          clearInterval(timer)
          // Auto advance to next story or close
          const allStories = [...myStories, ...stories]
          if (index < allStories.length - 1) {
            handleViewStory(allStories[index + 1], index + 1)
          } else {
            setShowStoryViewer(false)
          }
          return 0
        }
        return prev + 2 // 5 seconds total (100 / 2 = 50 intervals)
      })
    }, 100)

    setStoryTimer(timer)
  }

  const closeStoryViewer = () => {
    if (storyTimer) {
      clearInterval(storyTimer)
      setStoryTimer(null)
    }
    setShowStoryViewer(false)
    setSelectedStory(null)
    setStoryProgress(0)
  }

  const nextStory = () => {
    const allStories = [...myStories, ...stories]
    if (currentStoryIndex < allStories.length - 1) {
      if (storyTimer) clearInterval(storyTimer)
      handleViewStory(allStories[currentStoryIndex + 1], currentStoryIndex + 1)
    } else {
      closeStoryViewer()
    }
  }

  const prevStory = () => {
    const allStories = [...myStories, ...stories]
    if (currentStoryIndex > 0) {
      if (storyTimer) clearInterval(storyTimer)
      handleViewStory(allStories[currentStoryIndex - 1], currentStoryIndex - 1)
    }
  }

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const hours = Math.floor(diff / (1000 * 60 * 60))
    
    if (hours < 1) return 'Just now'
    if (hours === 1) return '1 hour ago'
    return `${hours} hours ago`
  }

  // Group other users' stories by user
  const groupedStories = stories.reduce((acc, story) => {
    const userId = story.userId
    if (!acc[userId]) {
      acc[userId] = []
    }
    acc[userId].push(story)
    return acc
  }, {} as Record<string, Story[]>)

  return (
    <div className="bg-white border-b border-gray-200 p-4">
      <div className="flex items-center space-x-4 overflow-x-auto">
        {/* My Story */}
        <div className="flex-shrink-0">
          <div
            className="relative cursor-pointer"
            onClick={() => myStories.length > 0 ? handleViewStory(myStories[0], 0) : setShowAddStory(true)}
          >
            <div className={`w-16 h-16 rounded-full p-0.5 ${myStories.length > 0 ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-gray-200'}`}>
              <Avatar className="w-full h-full border-2 border-white">
                <AvatarImage src={currentUser?.avatarUrl} />
                <AvatarFallback className="bg-gray-100">
                  {currentUser?.displayName?.charAt(0) || 'U'}
                </AvatarFallback>
              </Avatar>
            </div>
            {myStories.length === 0 && (
              <div className="absolute bottom-0 right-0 w-5 h-5 bg-whatsapp-primary rounded-full flex items-center justify-center border-2 border-white">
                <Plus className="w-3 h-3 text-white" />
              </div>
            )}
          </div>
          <p className="text-xs text-center mt-1 text-gray-600">
            {myStories.length > 0 ? 'My Status' : 'Add Status'}
          </p>
        </div>

        {/* Other Users' Stories */}
        {Object.entries(groupedStories).map(([userId, userStories]) => {
          const user = userStories[0].user
          const hasUnviewed = userStories.some(story => 
            !story.views?.some(view => view.viewerId === currentUser?.id)
          )

          return (
            <div key={userId} className="flex-shrink-0">
              <div
                className="relative cursor-pointer"
                onClick={() => handleViewStory(userStories[0], myStories.length + stories.findIndex(s => s.userId === userId))}
              >
                <div className={`w-16 h-16 rounded-full p-0.5 ${hasUnviewed ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-gray-300'}`}>
                  <Avatar className="w-full h-full border-2 border-white">
                    <AvatarImage src={user?.avatarUrl} />
                    <AvatarFallback className="bg-gray-100">
                      {user?.displayName?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <Badge className="absolute -top-1 -right-1 bg-whatsapp-primary text-white text-xs px-1 min-w-[20px] h-5">
                  {userStories.length}
                </Badge>
              </div>
              <p className="text-xs text-center mt-1 text-gray-600 truncate w-16">
                {user?.displayName}
              </p>
            </div>
          )
        })}
      </div>

      {/* Add Story Dialog */}
      <Dialog open={showAddStory} onOpenChange={setShowAddStory}>
        <DialogContent className="sm:max-w-md">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Add to your status</h3>
            
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="hidden"
                id="story-file"
              />
              <label htmlFor="story-file" className="cursor-pointer">
                {selectedFile ? (
                  <div>
                    <p className="text-sm font-medium">{selectedFile.name}</p>
                    <p className="text-xs text-gray-500">Click to change</p>
                  </div>
                ) : (
                  <div>
                    <Plus className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                    <p className="text-sm text-gray-600">Click to select photo or video</p>
                  </div>
                )}
              </label>
            </div>

            <Input
              placeholder="Add a caption..."
              value={storyCaption}
              onChange={(e) => setStoryCaption(e.target.value)}
            />

            <div className="flex space-x-2">
              <Button
                variant="outline"
                onClick={() => setShowAddStory(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddStory}
                disabled={!selectedFile}
                className="flex-1 bg-whatsapp-primary hover:bg-whatsapp-accent"
              >
                Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Story Viewer */}
      <Dialog open={showStoryViewer} onOpenChange={closeStoryViewer}>
        <DialogContent className="sm:max-w-md p-0 bg-black">
          {selectedStory && (
            <div className="relative h-[600px] flex flex-col">
              {/* Progress Bar */}
              <div className="absolute top-2 left-2 right-2 z-10">
                <div className="w-full h-1 bg-white/30 rounded-full">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-100"
                    style={{ width: `${storyProgress}%` }}
                  />
                </div>
              </div>

              {/* Header */}
              <div className="absolute top-6 left-2 right-2 z-10 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Avatar className="w-8 h-8">
                    <AvatarImage src={selectedStory.user?.avatarUrl} />
                    <AvatarFallback className="bg-gray-600 text-white text-xs">
                      {selectedStory.user?.displayName?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-white text-sm font-medium">
                      {selectedStory.user?.displayName}
                    </p>
                    <p className="text-white/70 text-xs">
                      {formatTimeAgo(selectedStory.createdAt)}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={closeStoryViewer}
                  className="text-white hover:bg-white/20"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Story Content */}
              <div className="flex-1 flex items-center justify-center">
                {selectedStory.contentType === 'image' ? (
                  <img
                    src={selectedStory.contentUrl}
                    alt="Story"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <video
                    src={selectedStory.contentUrl}
                    autoPlay
                    muted
                    className="max-w-full max-h-full object-contain"
                  />
                )}
              </div>

              {/* Caption */}
              {selectedStory.caption && (
                <div className="absolute bottom-16 left-2 right-2">
                  <p className="text-white text-center bg-black/50 rounded-lg p-2">
                    {selectedStory.caption}
                  </p>
                </div>
              )}

              {/* Navigation */}
              <div className="absolute inset-0 flex">
                <div className="flex-1" onClick={prevStory} />
                <div className="flex-1" onClick={nextStory} />
              </div>

              {/* Views (for own stories) */}
              {selectedStory.userId === currentUser?.id && selectedStory.views && selectedStory.views.length > 0 && (
                <div className="absolute bottom-2 left-2 right-2">
                  <div className="bg-black/70 rounded-lg p-2">
                    <div className="flex items-center space-x-1 text-white text-sm">
                      <Eye className="w-4 h-4" />
                      <span>{selectedStory.views.length}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}