import { findObjectByWebGLProgram } from './helpers/findObjectByWebGLProgram'
import { findTextureByWebGLTexture } from './helpers/findTextureByWebGLTexture'

let lastCurrentRenderTarget = null
function getLastRenderTarget() {
  return lastCurrentRenderTarget
}

export function setLastRenderTarget(value) {
  lastCurrentRenderTarget = value
}

function improveWebGLError(scene, gl, { errors }) {
  const { errorInfo, error, functionName, errorName } = errors

  const ctx = gl.getContext()

  //     // Log current shader program
  const shaderProgram = ctx.getParameter(ctx.CURRENT_PROGRAM)

  let relatedTextures = null
  let obj = null
  if (scene) {
    obj = findObjectByWebGLProgram(scene, gl, shaderProgram)
    //   //     // Log bound 2D texture
    relatedTextures = findTextureByWebGLTexture(scene, gl)
    if (!obj && relatedTextures) {
      obj = relatedTextures.object
    }
    //     const programInfoLog = ctx.getProgramInfoLog(shaderProgram)
  }
  console.group(
    `%cWebGL: ${functionName}: ${errorName}: ${
      relatedTextures ? relatedTextures.property : ''
    }`,
    'color: white; background: #f14f1e; font-family: "Courier New", monospace; padding: 2px 5px; border-radius: 4px;'
  )

  if (error) {
    console.log('%cError Details:', 'color: #f4511e; font-weight: bold;', error)
  }

  if (obj) {
    console.log('%cAffected Object:', 'color: #fb8c00; font-weight: bold;', obj)
  }

  // Log bound framebuffer
  const framebuffer = ctx.getParameter(ctx.FRAMEBUFFER_BINDING)
  if (framebuffer && getLastRenderTarget()) {
    console.log(
      '%cRenderer by Framebuffer:',
      'color: #8ab4f9; font-weight: bold;',
      getLastRenderTarget()
    )
  }

  // Log bound renderbuffer
  const renderbuffer = ctx.getParameter(ctx.RENDERBUFFER_BINDING)
  if (renderbuffer) {
    console.log(
      '%cBound Renderbuffer:',
      'color: #8ab4f9; font-weight: bold;',
      renderbuffer
    )
  }

  if (relatedTextures) {
    const { value, object, material, property } = relatedTextures
    console.groupCollapsed(
      `%cProblematic Texture: ${value.property}`,
      'color: white; background: #6d4c41; font-family: "Courier New", monospace; padding: 2px 5px; border-radius: 4px; font-weight: bold;'
    )
    console.log(
      '%cProperty Name:',
      'color: #fb8c00; font-weight: bold;',
      property
    )
    console.group('%cObject:', 'color: #fb8c00; font-weight: bold;', object)
    console.log('%cMaterial:', 'color: #fb8c00; font-weight: bold;', material)
    console.groupEnd()
    console.groupEnd()
  }

  // Add any other context information you want to log
  if (errorInfo) {
    const errorMessage = `${errorInfo.url}:${errorInfo.lineNo}`

    console.warn(
      `%cError Source: ${
        errorInfo.funcName.split('.')[1] || errorInfo.funcName
      }:`,
      'color: #f4511e; font-weight: bold;',
      errorMessage
    )
  }

  console.groupEnd()
  //   }
}

export { improveWebGLError }
