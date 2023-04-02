import { improveWebGLError } from './improveWebGLErrors'
import { augmentAPI } from './webgl-lint/augment-api'

let baseContext = null

function wrapGetContext(CanvasElement) {
  const originalGetContext = CanvasElement.prototype.getContext

  CanvasElement.prototype.getContext = function getContextPatched(
    type,
    ...args
  ) {
    const originalContext = originalGetContext.apply(this, [type, ...args])

    if (type === 'webgl' || type === 'webgl2') {
      const config = {
        maxDrawCalls: 1000,
        throwOnError: true,
        failBadShadersAndPrograms: true,
        failUnsetUniforms: true,
        failUnsetSamplerUniforms: false,
        failZeroMatrixUniforms: true,
        failUnrenderableTextures: true,
        failUndefinedUniforms: false,
        warnUndefinedUniforms: true,
        makeDefaultTags: true,
        ignoreUniforms: [],
      }
      augmentAPI(originalContext, type, config)
    }
    return originalContext
  }
}

if (typeof HTMLCanvasElement !== 'undefined') {
  wrapGetContext(HTMLCanvasElement)
}

if (typeof OffscreenCanvas !== 'undefined') {
  wrapGetContext(OffscreenCanvas)
}

// Add an event listener to your canvas element
function threejsDebug(scene, renderer) {
  if (!scene || !renderer) {
    console.error('Scene or renderer is missing.')
    return
  }

  const canvas = renderer.domElement

  if (!canvas) {
    console.error('Canvas element not found.')
    return
  }

  const baseContext = renderer.getContext()

  if (!baseContext) {
    console.error('Unable to get WebGL context from renderer.')
    return
  }

  canvas.addEventListener('webglcontexterror', (event) => {
    // Call improveWebGLError with the scene and gl variables
    improveWebGLError(scene, renderer, event)
  })
}

function webglDebug(canvas) {
  if (!canvas) {
    console.error('Canvas element not found.')
    return
  }

  if (typeof canvas.getContext === 'undefined') {
    console.error('getContext function does not exist on canvas element.')
    return
  }

  if (!baseContext) {
    console.error(
      'Unable to initialize WebGL2 context. Your browser may not support it.'
    )
    return
  }

  baseContext = canvas.getContext('webgl2')
  canvas.addEventListener('webglcontexterror', (event) => {
    // Call improveWebGLError with the scene and gl variables
    improveWebGLError(null, null, event)
  })
}

export { threejsDebug, webglDebug }
