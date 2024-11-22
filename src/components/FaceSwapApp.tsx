'use client'

import { useEffect, useRef, useState } from 'react'
import * as faceapi from 'face-api.js'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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

  const createCompleteFaceMask = (
    ctx: CanvasRenderingContext2D,
    landmarks: faceapi.FaceLandmarks68,
    scale: number = 1,
    offsetX: number = 0,
    offsetY: number = 0
  ) => {
    ctx.beginPath()
    
    // Jaw line
    const jawLine = landmarks.getJawOutline()
    ctx.moveTo(jawLine[0].x * scale + offsetX, jawLine[0].y * scale + offsetY)
    jawLine.forEach((point) => {
      ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY)
    })

    // Include nose bridge
    const noseBridge = landmarks.getNose()
    noseBridge.forEach((point) => {
      ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY)
    })

    // Include mouth outline
    const upperLip = landmarks.getMouth()
    upperLip.forEach((point) => {
      ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY)
    })

    // Include eyes
    const leftEye = landmarks.getLeftEye()
    leftEye.forEach((point) => {
      ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY)
    })

    const rightEye = landmarks.getRightEye()
    rightEye.forEach((point) => {
      ctx.lineTo(point.x * scale + offsetX, point.y * scale + offsetY)
    })

    ctx.closePath()
    return ctx
  }

  const matchColors = (
    sourceCtx: CanvasRenderingContext2D, 
    targetCtx: CanvasRenderingContext2D,
    sourceFace: faceapi.FaceLandmarks68,
    targetFace: faceapi.FaceLandmarks68,
    scale: number
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

      // Calculate scaling and position
      const scale = targetFace.detection.box.width / sourceFace.detection.box.width
      const offsetX = targetFace.detection.box.x - (sourceFace.detection.box.x * scale)
      const offsetY = targetFace.detection.box.y - (sourceFace.detection.box.y * scale)

      // Create and setup source canvas
      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = canvas.width
      sourceCanvas.height = canvas.height
      const sourceCtx = sourceCanvas.getContext('2d')
      if (!sourceCtx) throw new Error('Failed to get source canvas context')

      // Draw and transform source image
      sourceCtx.save()
      sourceCtx.scale(scale, scale)
      sourceCtx.translate(offsetX / scale, offsetY / scale)
      sourceCtx.drawImage(uploadedImage, 0, 0)
      sourceCtx.restore()

      // Color correction
      matchColors(sourceCtx, ctx, sourceFace.landmarks, targetFace.landmarks, scale)

      // Create face mask
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = canvas.width
      maskCanvas.height = canvas.height
      const maskCtx = maskCanvas.getContext('2d')
      if (!maskCtx) throw new Error('Failed to get mask canvas context')

      // Create complete face mask
      createCompleteFaceMask(maskCtx, targetFace.landmarks, 1)
      maskCtx.fillStyle = 'white'
      maskCtx.fill()

      // Apply strong feathering
      maskCtx.filter = 'blur(8px)'
      maskCtx.drawImage(maskCanvas, 0, 0)
      maskCtx.filter = 'none'

      // Gradient edge blending
      const gradient = maskCtx.createRadialGradient(
        targetFace.detection.box.x + targetFace.detection.box.width / 2,
        targetFace.detection.box.y + targetFace.detection.box.height / 2,
        targetFace.detection.box.width / 3,
        targetFace.detection.box.x + targetFace.detection.box.width / 2,
        targetFace.detection.box.y + targetFace.detection.box.height / 2,
        targetFace.detection.box.width
      )
      gradient.addColorStop(0, 'white')
      gradient.addColorStop(1, 'transparent')
      maskCtx.fillStyle = gradient
      maskCtx.fill()

      // Final blending
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(maskCanvas, 0, 0)
      ctx.restore()

      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 0.95 // Slightly transparent for better blending
      ctx.drawImage(sourceCanvas, 0, 0)
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
    <div className="container mx-auto p-4">
      <Card className="max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle>NVIDIA GPU Face Swap</CardTitle>
          <CardDescription>
            Upload your photo to receive GPUs from Jensen Huang
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-center gap-4">
              <Input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="flex-1"
              />
              <Button
                onClick={processImages}
                disabled={!selectedImage || loading || !modelsLoaded}
              >
                {loading ? (
                  'Processing...'
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
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {selectedImage && (
              <div className="aspect-video relative rounded-lg overflow-hidden bg-muted">
                <img
                  src={selectedImage}
                  alt="Uploaded"
                  className="object-contain w-full h-full"
                />
              </div>
            )}

            {processedImage && (
              <div className="space-y-2">
                <h3 className="font-semibold">Result:</h3>
                <div className="aspect-video relative rounded-lg overflow-hidden bg-muted">
                  <img
                    src={processedImage}
                    alt="Processed"
                    className="object-contain w-full h-full"
                  />
                </div>
                <Button asChild className="w-full">
                  <a href={processedImage} download="nvidia-face-swap.png">
                    Download Result
                  </a>
                </Button>
              </div>
            )}
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

