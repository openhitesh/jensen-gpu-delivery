'use client'

import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Upload, CpuIcon as Gpu, Package, Sparkles, Gift } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import Image from 'next/image'

export default function FaceSwapApp() {
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [processedImage, setProcessedImage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const templateImage = '/template.jpg'

  useEffect(() => {
    const loadModels = async () => {
      try {
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
          faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
          faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
        ])
        setModelsLoaded(true)
      } catch (error) {
        console.error('Error loading models:', error)
        setError('Failed to load face detection models. Please try refreshing the page.')
      }
    }
    loadModels()
  }, [])

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        setSelectedImage(e.target?.result as string)
        setError(null) // Clear any previous errors
      }
      reader.readAsDataURL(file)
    }
  }

  const extractFace = (
    ctx: CanvasRenderingContext2D,
    landmarks: faceapi.FaceLandmarks68,
    scale: number = 1,
  ): ImageData => {
    const faceCanvas = document.createElement('canvas')
    const faceCtx = faceCanvas.getContext('2d')
    if (!faceCtx) throw new Error('Failed to get face canvas context')

    // Get face bounds with extra padding for hair
    const bounds = landmarks.positions.reduce(
      (acc, point) => ({
        minX: Math.min(acc.minX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxX: Math.max(acc.maxX, point.x),
        maxY: Math.max(acc.maxY, point.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    )

    // Add extra padding for hair and sides
    const padding = {
      x: (bounds.maxX - bounds.minX) * 0.3, // Increased side padding
      y: (bounds.maxY - bounds.minY) * 0.7  // Increased top padding for hair
    }

    const width = (bounds.maxX - bounds.minX + padding.x * 2) * scale
    const height = (bounds.maxY - bounds.minY + padding.y * 2) * scale

    faceCanvas.width = width
    faceCanvas.height = height

    // Create head shape path
    faceCtx.beginPath()

    // Start from bottom left of jaw
    const jawLine = landmarks.getJawOutline()
    const firstPoint = jawLine[0]
    faceCtx.moveTo(
      (firstPoint.x - bounds.minX + padding.x) * scale,
      (firstPoint.y - bounds.minY + padding.y) * scale
    )

    // Draw jaw line
    jawLine.forEach(point => {
      faceCtx.lineTo(
        (point.x - bounds.minX + padding.x) * scale,
        (point.y - bounds.minY + padding.y) * scale
      )
    })

    // Create natural head shape
    const topOfHead = bounds.minY - padding.y * 0.5 // Approximate top of head
    const headWidth = bounds.maxX - bounds.minX
    
    // Right side of head
    faceCtx.bezierCurveTo(
      ((bounds.maxX + padding.x * 0.5) - bounds.minX + padding.x) * scale,
      (bounds.minY - bounds.minY + padding.y) * scale,
      ((bounds.maxX + padding.x * 0.3) - bounds.minX + padding.x) * scale,
      (topOfHead - bounds.minY + padding.y) * scale,
      ((bounds.minX + headWidth * 0.5) - bounds.minX + padding.x) * scale,
      (topOfHead - bounds.minY + padding.y) * scale
    )

    // Left side of head
    faceCtx.bezierCurveTo(
      ((bounds.minX - padding.x * 0.3) - bounds.minX + padding.x) * scale,
      (topOfHead - bounds.minY + padding.y) * scale,
      ((bounds.minX - padding.x * 0.5) - bounds.minX + padding.x) * scale,
      (bounds.minY - bounds.minY + padding.y) * scale,
      (firstPoint.x - bounds.minX + padding.x) * scale,
      (firstPoint.y - bounds.minY + padding.y) * scale
    )

    faceCtx.closePath()
    faceCtx.clip()

    // Draw the face portion with the natural head shape
    faceCtx.drawImage(
      ctx.canvas,
      bounds.minX - padding.x,
      bounds.minY - padding.y,
      bounds.maxX - bounds.minX + padding.x * 2,
      bounds.maxY - bounds.minY + padding.y * 2,
      0,
      0,
      width,
      height
    )

    return faceCtx.getImageData(0, 0, width, height)
  }

  const matchColors = (
    sourceCtx: CanvasRenderingContext2D, 
    targetCtx: CanvasRenderingContext2D,
    sourceFace: faceapi.FaceLandmarks68,
    targetFace: faceapi.FaceLandmarks68
  ) => {
    // Get color samples from both faces
    const sourceColor = getAverageFaceColor(sourceCtx, sourceFace)
    const targetColor = getAverageFaceColor(targetCtx, targetFace)

    // Calculate color adjustment
    const colorAdjust = {
      r: targetColor.r - sourceColor.r,
      g: targetColor.g - sourceColor.g,
      b: targetColor.b - sourceColor.b,
    }

    // Apply color adjustment
    const imageData = sourceCtx.getImageData(0, 0, sourceCtx.canvas.width, sourceCtx.canvas.height)
    const data = imageData.data

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.min(255, Math.max(0, data[i] + colorAdjust.r))
      data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + colorAdjust.g))
      data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + colorAdjust.b))
    }

    sourceCtx.putImageData(imageData, 0, 0)
  }

  const getAverageFaceColor = (ctx: CanvasRenderingContext2D, face: faceapi.FaceLandmarks68) => {
    const samplePoints = face.positions.slice(0, 10) // Use first 10 points for sampling
    let r = 0, g = 0, b = 0
    
    samplePoints.forEach(point => {
      const pixel = ctx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data
      r += pixel[0]
      g += pixel[1]
      b += pixel[2]
    })

    return {
      r: r / samplePoints.length,
      g: g / samplePoints.length,
      b: b / samplePoints.length
    }
  }

  const processImages = async () => {
    if (!selectedImage || !modelsLoaded || !canvasRef.current) return

    setLoading(true)
    setError(null)
    try {
      // Load images
      const template = await loadImage(templateImage)
      const uploadedImage = await loadImage(selectedImage)

      // Setup main canvas
      const canvas = canvasRef.current
      canvas.width = template.width
      canvas.height = template.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Failed to get canvas context')

      // Draw template
      ctx.drawImage(template, 0, 0)

      // Detect faces
      const templateFaces = await faceapi.detectAllFaces(
        template,
        new faceapi.TinyFaceDetectorOptions()
      ).withFaceLandmarks()

      const uploadedFaces = await faceapi.detectAllFaces(
        uploadedImage,
        new faceapi.TinyFaceDetectorOptions()
      ).withFaceLandmarks()

      if (templateFaces.length < 2) throw new Error('Could not detect two faces in the template image')
      if (uploadedFaces.length === 0) throw new Error('Could not detect a face in the uploaded image')

      // Get target face (rightmost face)
      const targetFace = templateFaces.reduce((prev, current) => 
        prev.detection.box.x > current.detection.box.x ? prev : current
      )
      const sourceFace = uploadedFaces[0]

      // Extract the source face
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = uploadedImage.width
      sourceCanvas.height = uploadedImage.height
      const sourceCtx = sourceCanvas.getContext('2d')
      if (!sourceCtx) throw new Error('Failed to get source canvas context')
      sourceCtx.drawImage(uploadedImage, 0, 0)

      const extractedFace = extractFace(sourceCtx, sourceFace.landmarks)

      // Calculate scaling and position
      const scale = targetFace.detection.box.width / extractedFace.width
      const targetX = targetFace.detection.box.x + targetFace.detection.box.width / 2
      const targetY = targetFace.detection.box.y + targetFace.detection.box.height / 2

      // Create temporary canvas for the extracted face
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = extractedFace.width
      tempCanvas.height = extractedFace.height
      const tempCtx = tempCanvas.getContext('2d')
      if (!tempCtx) throw new Error('Failed to get temporary canvas context')

      // Draw the extracted face
      tempCtx.putImageData(extractedFace, 0, 0)

      // Apply color correction
      matchColors(tempCtx, ctx, sourceFace.landmarks, targetFace.landmarks)

      // Draw and position the extracted face
      ctx.save()
      ctx.translate(targetX, targetY)
      ctx.scale(scale, scale)
      ctx.translate(-extractedFace.width / 2, -extractedFace.height / 2)
      ctx.drawImage(tempCanvas, 0, 0)
      ctx.restore()

      // Final blending
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.95 // Slightly transparent for better blending
      ctx.drawImage(canvas, 0, 0)
      ctx.restore()

      // Save result
      setProcessedImage(canvas.toDataURL())
    } catch (error) {
      console.error('Error processing images:', error)
      setError(error instanceof Error ? error.message : 'An unknown error occurred')
    } finally {
      setLoading(false)
    }
  }

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
      img.src = src
    })
  }

  return (
    <div className="container mx-auto p-4 min-h-screen bg-gradient-to-b from-background to-muted">
      <Card className="max-w-2xl mx-auto border-2 border-green-500 shadow-2xl">
        <CardHeader className="text-center space-y-4 pb-8">
          <div className="flex items-center justify-center gap-3 animate-pulse">
            <Gpu className="w-8 h-8 text-green-500" />
            <CardTitle className="text-4xl font-black bg-gradient-to-r from-green-500 to-emerald-700 text-transparent bg-clip-text">
              Jensen GPU Delivery
            </CardTitle>
            <Gpu className="w-8 h-8 text-emerald-700" />
          </div>
          <div className="space-y-2">
            <CardDescription className="text-lg">
              🎉 <span className="font-bold">Upload your photo</span> and join the exclusive club of 
              <span className="font-bold text-green-600"> GPU recipients!</span> 🎉
            </CardDescription>
            <p className="text-sm text-muted-foreground italic">
              &ldquo;In the world of AI, GPUs are like pizza - everyone needs a slice!&rdquo; - Jensen Huang
            </p>
          </div>
          <div className="flex justify-center gap-4 pt-2">
            <Package className="w-5 h-5 animate-bounce text-green-500" />
            <Sparkles className="w-5 h-5 animate-bounce delay-100 text-emerald-600" />
            <Gift className="w-5 h-5 animate-bounce delay-200 text-green-500" />
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="flex-1 file:bg-green-500 file:text-white file:border-0 
                          file:rounded-full file:font-semibold file:hover:bg-green-600 
                          file:transition-colors cursor-pointer"
              />
              <Button
                onClick={processImages}
                disabled={!selectedImage || loading || !modelsLoaded}
                className={cn(
                  "bg-green-500 hover:bg-green-600 text-white font-bold",
                  loading && "animate-pulse"
                )}
              >
                {loading ? (
                  'Summoning GPUs...'
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Process
                  </>
                )}
              </Button>
            </div>
            
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Oops! No GPUs Found</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {selectedImage && (
              <div className="space-y-2">
                <h3 className="font-bold text-green-600 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Your Photo
                </h3>
                <div className="aspect-video relative rounded-lg overflow-hidden bg-muted border-2 border-green-200">
                  <Image
                    src={selectedImage}
                    alt="Uploaded"
                    layout="fill"
                    objectFit="contain"
                  />
                </div>
              </div>
            )}

            {processedImage && (
              <div className="space-y-2">
                <h3 className="font-bold text-green-600 flex items-center gap-2">
                  <Gift className="w-4 h-4" />
                  Your GPU Delivery Moment!
                </h3>
                <div className="aspect-video relative rounded-lg overflow-hidden bg-muted border-2 border-green-200">
                  <Image
                    src={processedImage}
                    alt="Processed"
                    layout="fill"
                    objectFit="contain"
                  />
                </div>
                <Button 
                  asChild 
                  className="w-full bg-green-500 hover:bg-green-600 text-white font-bold group"
                >
                  <a href={processedImage} download="jensen-gpu-delivery.png">
                    <Package className="mr-2 h-4 w-4 group-hover:animate-bounce" />
                    Download Your GPU Moment
                  </a>
                </Button>
              </div>
            )}
          </div>

          <div className="text-center text-sm text-muted-foreground mt-6">
            <p className="font-semibold">🎮 Bonus Feature:</p>
            <p className="italic">Every processed image comes with virtual GPU compute power!</p>
            <p className="text-xs">(Results may vary, GPUs not guaranteed)</p>
          </div>

          <canvas
            ref={canvasRef}
            className="hidden"
          />
        </CardContent>
      </Card>
    </div>
  )
}

