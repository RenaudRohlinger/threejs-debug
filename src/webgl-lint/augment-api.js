/*
The MIT License (MIT)

Copyright (c) 2019 Gregg Tavares

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import { checkAttributesForBufferOverflow } from './check-attributes-buffer-overflow.js'
import { checkFramebufferFeedback } from './check-framebuffer-feedback.js'
import { parseStack } from './parse-stack.js'
import { TextureManager } from './texture-manager.js'
import {
  addEnumsFromAPI,
  enumArrayToString,
  getBindingQueryEnumForBindPoint,
  getDrawFunctionArgs,
  getUniformTypeInfo,
  glEnumToString,
  isArrayThatCanHaveBadValues,
  isDrawFunction,
  isTypedArray,
  makeBitFieldToStringFunc,
  quotedStringOrEmpty,
} from './utils.js'

class WebGLContextErrorEvent extends Event {
  constructor(errors) {
    super('webglcontexterror', { bubbles: false, cancelable: false })

    this.errors = errors
  }
}

/* global console */
/* global WebGL2RenderingContext */
/* global WebGLUniformLocation */

//------------ [ from https://github.com/KhronosGroup/WebGLDeveloperTools ]

/*
 ** Copyright (c) 2012 The Khronos Group Inc.
 **
 ** Permission is hereby granted, free of charge, to any person obtaining a
 ** copy of this software and/or associated documentation files (the
 ** "Materials"), to deal in the Materials without restriction, including
 ** without limitation the rights to use, copy, modify, merge, publish,
 ** distribute, sublicense, and/or sell copies of the Materials, and to
 ** permit persons to whom the Materials are furnished to do so, subject to
 ** the following conditions:
 **
 ** The above copyright notice and this permission notice shall be included
 ** in all copies or substantial portions of the Materials.
 **
 ** THE MATERIALS ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 ** EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 ** MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 ** IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 ** CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 ** TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 ** MATERIALS OR THE USE OR OTHER DEALINGS IN THE MATERIALS.
 */

const destBufferBitFieldToString = makeBitFieldToStringFunc([
  'COLOR_BUFFER_BIT',
  'DEPTH_BUFFER_BIT',
  'STENCIL_BUFFER_BIT',
])

function convertToObjectIfArray(obj, key) {
  if (Array.isArray(obj[key])) {
    obj[key] = Object.fromEntries(obj[key].map((ndx) => [Math.abs(ndx), ndx]))
  }
}

/*
function indexedBindHelper(gl, funcName, args, value) {
  const [target, index] = args;
  switch (target) {
    case gl.TRANSFORM_FEEDBACK_BUFFER:
      return gl.getIndexedBinding(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING, index);
      break;
    case gl.UNIFORM_BUFFER:
      return gl.getIndexedBinding(gl.UNIFORM_BUFFER_BINDING, index);
      break;
  }
}
*/

function getUniformNameErrorMsg(ctx, funcName, args, sharedState) {
  const location = args[0]
  const name = sharedState.locationsToNamesMap.get(location)
  const prg = ctx.getParameter(ctx.CURRENT_PROGRAM)
  const msgs = []
  if (name) {
    msgs.push(`trying to set uniform '${name}'`)
  }
  if (prg) {
    const name = sharedState.webglObjectToNamesMap.get(prg)
    if (name) {
      msgs.push(`on WebGLProgram(${quotedStringOrEmpty(name)})`)
    }
  } else {
    msgs.push('on ** no current program **')
  }
  return msgs.length ? `: ${msgs.join(' ')}` : ''
}

function throwIfNotWebGLObject(webglObject) {
  // There's no easy way to check if it's a WebGLObject
  // and I guess we mostly don't care but a minor check is probably
  // okay
  if (
    Array.isArray(webglObject) ||
    isTypedArray(webglObject) ||
    typeof webglObject !== 'object'
  ) {
    throw new Error('not a WebGLObject')
  }
}

const augmentedSet = new Set()

/**
 * Given a WebGL context replaces all the functions with wrapped functions
 * that call gl.getError after every command
 *
 * @param {WebGLRenderingContext|Extension} ctx The webgl context to wrap.
 * @param {string} nameOfClass (eg, webgl, webgl2, OES_texture_float)
 */
export function augmentAPI(ctx, nameOfClass, options = {}) {
  // eslint-disable-line consistent-return

  if (augmentedSet.has(ctx)) {
    return ctx
  }
  augmentedSet.add(ctx)

  const origGLErrorFn = options.origGLErrorFn || ctx.getError
  addEnumsFromAPI(ctx)

  const postChecks = {
    drawArrays: checkMaxDrawCallsAndZeroCount,
    drawElements: checkMaxDrawCallsAndZeroCount,
    drawArraysInstanced: checkMaxDrawCallsAndZeroCount,
    drawElementsInstanced: checkMaxDrawCallsAndZeroCount,
    drawArraysInstancedANGLE: checkMaxDrawCallsAndZeroCount,
    drawElementsInstancedANGLE: checkMaxDrawCallsAndZeroCount,
    drawRangeElements: checkMaxDrawCallsAndZeroCount,
    getSupportedExtensions(ctx, funcName, args, result) {
      result.push('GMAN_debug_helper')
    },
  }

  function createSharedState(ctx) {
    const sharedState = {
      baseContext: ctx,
      config: options,
      apis: {
        // custom extension
        gman_debug_helper: {
          ctx: {
            tagObject(webglObject, name) {
              throwIfNotWebGLObject(webglObject)
              sharedState.webglObjectToNamesMap.set(webglObject, name)
            },
            untagObject(webglObject) {
              throwIfNotWebGLObject(webglObject)
              sharedState.webglObjectToNamesMap.delete(webglObject)
            },
            getTagForObject(webglObject) {
              return sharedState.webglObjectToNamesMap.get(webglObject)
            },
            disable() {
              removeChecks()
            },
            setConfiguration(config) {
              for (const [key, value] of Object.entries(config)) {
                if (!(key in sharedState.config)) {
                  throw new Error(`unknown configuration option: ${key}`)
                }
                sharedState.config[key] = value
              }
              for (const name of sharedState.config.ignoreUniforms) {
                sharedState.ignoredUniforms.add(name)
              }
            },
          },
        },
      },
      idCounts: {},
      textureManager: new TextureManager(ctx),
      bufferToIndices: new Map(),
      ignoredUniforms: new Set(),
      // Okay or bad? This is a map of all WebGLUniformLocation object looked up
      // by the user via getUniformLocation. We use this to map a location back to
      // a name and unfortunately a WebGLUniformLocation is not unique, by which
      // I mean if you call get getUniformLocation twice for the same uniform you'll
      // get 2 different WebGLUniformLocation objects referring to the same location.
      //
      // So, that means I can't look up the locations myself and know what they are
      // unless I passed the location objects I looked up back to the user but if I
      // did that then technically I'd have changed the semantics (though I suspect
      // no one ever takes advantage of that quirk)
      //
      // In any case this is all uniforms for all programs. That means in order
      // to clean up later I have to track all the uniforms (see programToUniformMap)
      // so that makes me wonder if I should track names per program instead.
      //
      // The advantage to this global list is given a WebGLUniformLocation and
      // no other info I can lookup the name where as if I switch it to per-program
      // then I need to know the program. That's generally available but it's indirect.
      locationsToNamesMap: new Map(),
      webglObjectToNamesMap: new Map(),
      // @typedef {Object} UnusedUniformRef
      // @property {number} index the index of this name. for foo[3] it's 3
      // @property {Map<string, number>} altNames example <foo,0>, <foo[0],0>, <foo[1],1>, <foo[2],2>, <foo[3],3>  for `uniform vec4 foo[3]`
      // @property {Set<number>} unused this is size so for the example above it's `Set<[0, 1, 2, 3]`

      // Both the altName array and the unused Set are shared with an entry in `programToUnsetUniformsMap`
      // by each name (foo, foo[0], foo[1], foo[2]). That we we can unused.delete each element of set
      // and if set is empty then delete all altNames entries from programToUnsetUniformsMap.
      // When programsToUniformsMap is empty all uniforms have been set.
      // @typedef {Map<WebGLProgram, Map<string, UnusedUniformRef>}
      programToUnsetUniformsMap: new Map(),
      // class UniformInfo {
      //   index: the index of this name. for foo[3] it's 3
      //   size: this is the array size for this uniform
      //   type: the enum for the type like FLOAT_VEC4
      // }
      /** @type {WebGLProgram, Map<UniformInfo>} */
      programToUniformInfoMap: new Map(),
      /** @type {WebGLProgram, Set<WebGLUniformLocation>} */
      programToLocationsMap: new Map(),
      // class UniformSamplerInfo {
      //   type: the enum for the uniform type like SAMPLER_2D
      //   values: number[],
      //   name: string
      // }
      /** @type {WebGLProgram, UniformSamplerInfo[]} */
      programToUniformSamplerValues: new Map(),
    }
    return sharedState
  }

  const sharedState = options.sharedState || createSharedState(ctx)
  options.sharedState = sharedState

  const {
    apis,
    baseContext,
    bufferToIndices,
    config,
    ignoredUniforms,
    locationsToNamesMap,
    programToUniformInfoMap,
    programToUnsetUniformsMap,
    textureManager,
    webglObjectToNamesMap,
  } = sharedState

  const extensionFuncs = {
    oes_texture_float(...args) {
      textureManager.addExtension(...args)
    },
    oes_texture_float_linear(...args) {
      textureManager.addExtension(...args)
    },
    OES_texture_half_float(...args) {
      textureManager.addExtension(...args)
    },
    oes_texture_half_float_linear(...args) {
      textureManager.addExtension(...args)
    },
  }
  ;(extensionFuncs[nameOfClass] || noop)(nameOfClass)

  /**
   * Info about functions based on the number of arguments to the function.
   *
   * enums specifies which arguments are enums
   *
   *    'texImage2D': {
   *       9: { enums: [0, 2, 6, 7 ] },
   *       6: { enums: [0, 2, 3, 4 ] },
   *    },
   *
   * means if there are 9 arguments then 6 and 7 are enums, if there are 6
   * arguments 3 and 4 are enums. You can provide a function instead in
   * which case you should use object format. For example
   *
   *     `clear`: {
   *       1: { enums: { 0: convertClearBitsToString }},
   *     },
   *
   * numbers specifies which arguments are numbers, if an argument is negative that
   * argument might not be a number so we can check only check for NaN
   * arrays specifies which arguments are arrays
   *
   * @type {!Object.<number, (!Object.<number, string>|function)}
   */
  const glFunctionInfos = {
    // Generic setters and getters

    enable: { 1: { enums: [0] } },
    disable: { 1: { enums: [0] } },
    getParameter: { 1: { enums: [0] } },

    // Rendering

    drawArrays: { 3: { enums: [0], numbers: [1, 2] } },
    drawElements: { 4: { enums: [0, 2], numbers: [1, 3] } },
    drawArraysInstanced: { 4: { enums: [0], numbers: [1, 2, 3] } },
    drawElementsInstanced: { 5: { enums: [0, 2], numbers: [1, 3, 4] } },
    drawRangeElements: { 6: { enums: [0, 4], numbers: [1, 2, 3, 5] } },

    // Shaders

    createShader: { 1: { enums: [0] } },
    getActiveAttrib: { 2: { numbers: [1] } },
    getActiveUniform: { 2: { numbers: [1] } },
    getShaderParameter: { 2: { enums: [1] } },
    getProgramParameter: { 2: { enums: [1] } },
    getShaderPrecisionFormat: { 2: { enums: [0, 1] } },
    bindAttribLocation: { 3: { numbers: [1] } },

    // Vertex attributes

    getVertexAttrib: { 2: { enums: [1], numbers: [0] } },
    vertexAttribPointer: { 6: { enums: [2], numbers: [0, 1, 4, 5] } },
    vertexAttribIPointer: { 5: { enums: [2], numbers: [0, 1, 3, 4] } }, // WebGL2
    vertexAttribDivisor: { 2: { numbers: [0, 1] } }, // WebGL2
    disableVertexAttribArray: { 1: { numbers: [0] } },
    enableVertexAttribArray: { 1: { numbers: [0] } },

    // Textures

    bindTexture: { 2: { enums: [0] } },
    activeTexture: { 1: { enums: [0, 1] } },
    getTexParameter: { 2: { enums: [0, 1] } },
    texParameterf: { 3: { enums: [0, 1] } },
    texParameteri: { 3: { enums: [0, 1, 2] } },
    texImage2D: {
      9: { enums: [0, 2, 6, 7], numbers: [1, 3, 4, 5], arrays: [-8] },
      6: { enums: [0, 2, 3, 4] },
      10: {
        enums: [0, 2, 6, 7],
        numbers: [1, 3, 4, 5, 9],
        arrays: { 8: checkOptionalTypedArrayWithOffset },
      }, // WebGL2
    },
    texImage3D: {
      10: { enums: [0, 2, 7, 8], numbers: [1, 3, 4, 5] }, // WebGL2
      11: {
        enums: [0, 2, 7, 8],
        numbers: [1, 3, 4, 5, 10],
        arrays: { 9: checkTypedArrayWithOffset },
      }, // WebGL2
    },
    texSubImage2D: {
      9: { enums: [0, 6, 7], numbers: [1, 2, 3, 4, 5] },
      7: { enums: [0, 4, 5], numbers: [1, 2, 3] },
      10: {
        enums: [0, 6, 7],
        numbers: [1, 2, 3, 4, 5, 9],
        arrays: { 9: checkTypedArrayWithOffset },
      }, // WebGL2
    },
    texSubImage3D: {
      11: { enums: [0, 8, 9], numbers: [1, 2, 3, 4, 5, 6, 7] }, // WebGL2
      12: {
        enums: [0, 8, 9],
        numbers: [1, 2, 3, 4, 5, 6, 7, 11],
        arrays: { 10: checkTypedArrayWithOffset },
      }, // WebGL2
    },
    texStorage2D: { 5: { enums: [0, 2], numbers: [1, 3, 4] } }, // WebGL2
    texStorage3D: { 6: { enums: [0, 2], numbers: [1, 3, 4, 6] } }, // WebGL2
    copyTexImage2D: { 8: { enums: [0, 2], numbers: [1, 3, 4, 5, 6, 7] } },
    copyTexSubImage2D: { 8: { enums: [0], numbers: [1, 2, 3, 4, 5, 6, 7] } },
    copyTexSubImage3D: { 9: { enums: [0], numbers: [1, 2, 3, 4, 5, 6, 7, 8] } }, // WebGL2
    generateMipmap: { 1: { enums: [0] } },
    compressedTexImage2D: {
      7: { enums: [0, 2], numbers: [1, 3, 4, 5] },
      8: { enums: [0, 2], numbers: [1, 3, 4, 5, 7] }, // WebGL2
      9: { enums: [0, 2], numbers: [1, 3, 4, 5, 7, 8] }, // WebGL2
    },
    compressedTexSubImage2D: {
      8: { enums: [0, 6], numbers: [1, 2, 3, 4, 5] },
      9: { enums: [0, 6], numbers: [1, 2, 3, 4, 5, 8] }, // WebGL2
      10: { enums: [0, 6], numbers: [1, 2, 3, 4, 5, 8, 9] }, // WebGL2
    },
    compressedTexImage3D: {
      8: { enums: [0, 2], numbers: [1, 3, 4, 5, 6] }, // WebGL2
      9: { enums: [0, 2], numbers: [1, 3, 4, 5, 6, -7, 8] }, // WebGL2
      10: { enums: [0, 2], numbers: [1, 3, 4, 5, 6, 8, 9] }, // WebGL2
    },
    compressedTexSubImage3D: {
      12: { enums: [0, 8], numbers: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11] }, // WebGL2
      11: { enums: [0, 8], numbers: [1, 2, 3, 4, 5, 6, 7, 8, -9, 10] }, // WebGL2
      10: { enums: [0, 8], numbers: [1, 2, 3, 4, 5, 6, 7, 8] }, // WebGL2
    },

    // Buffer objects

    bindBuffer: { 2: { enums: [0] } },
    bufferData: {
      3: { enums: [0, 2], numbers: [-1], arrays: [-1] },
      4: {
        enums: [0, 2],
        numbers: [-1, 3],
        arrays: { 1: checkBufferSourceWithOffset },
      }, // WebGL2
      5: {
        enums: [0, 2],
        numbers: [-1, 3, 4],
        arrays: { 1: checkBufferSourceWithOffsetAndLength },
      }, // WebGL2
    },
    bufferSubData: {
      3: { enums: [0], numbers: [1], arrays: { 2: checkBufferSource } },
      4: {
        enums: [0],
        numbers: [1, 3],
        arrays: { 2: checkBufferSourceWithOffset },
      }, // WebGL2
      5: {
        enums: [0],
        numbers: [1, 3, 4],
        arrays: { 2: checkBufferSourceWithOffsetAndLength },
      }, // WebGL2
    },
    copyBufferSubData: {
      5: { enums: [0], numbers: [2, 3, 4] }, // WebGL2
    },
    getBufferParameter: { 2: { enums: [0, 1] } },
    getBufferSubData: {
      3: { enums: [0], numbers: [1] }, // WebGL2
      4: { enums: [0], numbers: [1, 3] }, // WebGL2
      5: { enums: [0], numbers: [1, 3, 4] }, // WebGL2
    },

    // Renderbuffers and framebuffers

    pixelStorei: { 2: { enums: [0, 1], numbers: [1] } },
    readPixels: {
      7: { enums: [4, 5], numbers: [0, 1, 2, 3, -6] },
      8: { enums: [4, 5], numbers: [0, 1, 2, 3, 7] }, // WebGL2
    },
    bindRenderbuffer: { 2: { enums: [0] } },
    bindFramebuffer: { 2: { enums: [0] } },
    blitFramebuffer: {
      10: {
        enums: { 8: destBufferBitFieldToString, 9: true },
        numbers: [0, 1, 2, 3, 4, 5, 6, 7],
      },
    }, // WebGL2
    checkFramebufferStatus: { 1: { enums: [0] } },
    framebufferRenderbuffer: { 4: { enums: [0, 1, 2] } },
    framebufferTexture2D: { 5: { enums: [0, 1, 2], numbers: [4] } },
    framebufferTextureLayer: { 5: { enums: [0, 1], numbers: [3, 4] } }, // WebGL2
    getFramebufferAttachmentParameter: { 3: { enums: [0, 1, 2] } },
    getInternalformatParameter: { 3: { enums: [0, 1, 2] } }, // WebGL2
    getRenderbufferParameter: { 2: { enums: [0, 1] } },
    invalidateFramebuffer: { 2: { enums: { 0: true, 1: enumArrayToString } } }, // WebGL2
    invalidateSubFramebuffer: {
      6: { enums: { 0: true, 1: enumArrayToString }, numbers: [2, 3, 4, 5] },
    }, // WebGL2
    readBuffer: { 1: { enums: [0] } }, // WebGL2
    renderbufferStorage: { 4: { enums: [0, 1], numbers: [2, 3] } },
    renderbufferStorageMultisample: {
      5: { enums: [0, 2], numbers: [1, 3, 4] },
    }, // WebGL2

    // Frame buffer operations (clear, blend, depth test, stencil)

    lineWidth: { 1: { numbers: [0] } },
    polygonOffset: { 2: { numbers: [0, 1] } },
    scissor: { 4: { numbers: [0, 1, 2, 3] } },
    viewport: { 4: { numbers: [0, 1, 2, 3] } },
    clear: { 1: { enums: { 0: destBufferBitFieldToString } } },
    clearColor: { 4: { numbers: [0, 1, 2, 3] } },
    clearDepth: { 1: { numbers: [0] } },
    clearStencil: { 1: { numbers: [0] } },
    depthFunc: { 1: { enums: [0] } },
    depthRange: { 2: { numbers: [0, 1] } },
    blendColor: { 4: { numbers: [0, 1, 2, 3] } },
    blendFunc: { 2: { enums: [0, 1] } },
    blendFuncSeparate: { 4: { enums: [0, 1, 2, 3] } },
    blendEquation: { 1: { enums: [0] } },
    blendEquationSeparate: { 2: { enums: [0, 1] } },
    stencilFunc: { 3: { enums: [0], numbers: [1, 2] } },
    stencilFuncSeparate: { 4: { enums: [0, 1], numberS: [2, 3] } },
    stencilMask: { 1: { numbers: [0] } },
    stencilMaskSeparate: { 2: { enums: [0], numbers: [1] } },
    stencilOp: { 3: { enums: [0, 1, 2] } },
    stencilOpSeparate: { 4: { enums: [0, 1, 2, 3] } },

    // Culling

    cullFace: { 1: { enums: [0] } },
    frontFace: { 1: { enums: [0] } },

    // ANGLE_instanced_arrays extension

    drawArraysInstancedANGLE: { 4: { enums: [0], numbers: [1, 2, 3] } },
    drawElementsInstancedANGLE: { 5: { enums: [0, 2], numbers: [1, 3, 4] } },

    // EXT_blend_minmax extension

    blendEquationEXT: { 1: { enums: [0] } },

    // Multiple Render Targets

    drawBuffersWebGL: { 1: { enums: { 0: enumArrayToString }, arrays: [0] } }, // WEBGL_draw_buffers
    drawBuffers: { 1: { enums: { 0: enumArrayToString }, arrays: [0] } }, // WebGL2
    clearBufferfv: {
      3: { enums: [0], numbers: [1], arrays: [2] }, // WebGL2
      4: { enums: [0], numbers: [1, 2], arrays: [2] }, // WebGL2
    },
    clearBufferiv: {
      3: { enums: [0], numbers: [1], arrays: [2] }, // WebGL2
      4: { enums: [0], numbers: [1, 2], arrays: [2] }, // WebGL2
    },
    clearBufferuiv: {
      3: { enums: [0], numbers: [1], arrays: [2] }, // WebGL2
      4: { enums: [0], numbers: [1, 2], arrays: [2] }, // WebGL2
    },
    clearBufferfi: { 4: { enums: [0], numbers: [1, 2, 3] } }, // WebGL2

    // uniform value setters
    uniform1f: { 2: { numbers: [1] } },
    uniform2f: { 3: { numbers: [1, 2] } },
    uniform3f: { 4: { numbers: [1, 2, 3] } },
    uniform4f: { 5: { numbers: [1, 2, 3, 4] } },

    uniform1i: { 2: { numbers: [1] } },
    uniform2i: { 3: { numbers: [1, 2] } },
    uniform3i: { 4: { numbers: [1, 2, 3] } },
    uniform4i: { 5: { numbers: [1, 2, 3, 4] } },

    uniform1fv: {
      2: { arrays: { 1: checkArrayForUniform(1) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(1) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(1) },
        numbers: [2, 3],
      },
    },
    uniform2fv: {
      2: { arrays: { 1: checkArrayForUniform(2) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(2) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(2) },
        numbers: [2, 3],
      },
    },
    uniform3fv: {
      2: { arrays: { 1: checkArrayForUniform(3) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(3) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(3) },
        numbers: [2, 3],
      },
    },
    uniform4fv: {
      2: { arrays: { 1: checkArrayForUniform(4) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(4) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(4) },
        numbers: [2, 3],
      },
    },

    uniform1iv: {
      2: { arrays: { 1: checkArrayForUniform(1) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(1) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(1) },
        numbers: [2, 3],
      },
    },
    uniform2iv: {
      2: { arrays: { 1: checkArrayForUniform(2) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(2) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(2) },
        numbers: [2, 3],
      },
    },
    uniform3iv: {
      2: { arrays: { 1: checkArrayForUniform(3) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(3) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(3) },
        numbers: [2, 3],
      },
    },
    uniform4iv: {
      2: { arrays: { 1: checkArrayForUniform(4) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(4) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(4) },
        numbers: [2, 3],
      },
    },

    uniformMatrix2fv: {
      3: { arrays: { 2: checkArrayForUniform(4) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(4) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(4) },
        numbers: [3, 4],
      },
    },
    uniformMatrix3fv: {
      3: { arrays: { 2: checkArrayForUniform(9) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(9) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(9) },
        numbers: [3, 4],
      },
    },
    uniformMatrix4fv: {
      3: { arrays: { 2: checkArrayForUniform(16) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(16) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(16) },
        numbers: [3, 4],
      },
    },

    uniform1ui: { 2: { numbers: [1] } }, // WebGL2
    uniform2ui: { 3: { numbers: [1, 2] } }, // WebGL2
    uniform3ui: { 4: { numbers: [1, 2, 3] } }, // WebGL2
    uniform4ui: { 5: { numbers: [1, 2, 3, 4] } }, // WebGL2

    uniform1uiv: {
      // WebGL2
      2: { arrays: { 1: checkArrayForUniform(1) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(1) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(1) },
        numbers: [2, 3],
      },
    },
    uniform2uiv: {
      // WebGL2
      2: { arrays: { 1: checkArrayForUniform(2) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(2) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(2) },
        numbers: [2, 3],
      },
    },
    uniform3uiv: {
      // WebGL2
      2: { arrays: { 1: checkArrayForUniform(3) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(3) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(3) },
        numbers: [2, 3],
      },
    },
    uniform4uiv: {
      // WebGL2
      2: { arrays: { 1: checkArrayForUniform(4) } },
      3: { arrays: { 1: checkArrayForUniformWithOffset(4) }, numbers: [2] },
      4: {
        arrays: { 1: checkArrayForUniformWithOffsetAndLength(4) },
        numbers: [2, 3],
      },
    },
    uniformMatrix3x2fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(6) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(6) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(6) },
        numbers: [3, 4],
      },
    },
    uniformMatrix4x2fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(8) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(8) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(8) },
        numbers: [3, 4],
      },
    },

    uniformMatrix2x3fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(6) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(6) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(6) },
        numbers: [3, 4],
      },
    },
    uniformMatrix4x3fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(12) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(12) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(12) },
        numbers: [3, 4],
      },
    },

    uniformMatrix2x4fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(8) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(8) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(8) },
        numbers: [3, 4],
      },
    },
    uniformMatrix3x4fv: {
      // WebGL2
      3: { arrays: { 2: checkArrayForUniform(12) } },
      4: { arrays: { 2: checkArrayForUniformWithOffset(12) }, numbers: [3] },
      5: {
        arrays: { 2: checkArrayForUniformWithOffsetAndLength(12) },
        numbers: [3, 4],
      },
    },

    // attribute value setters
    vertexAttrib1f: { 2: { numbers: [0, 1] } },
    vertexAttrib2f: { 3: { numbers: [0, 1, 2] } },
    vertexAttrib3f: { 4: { numbers: [0, 1, 2, 3] } },
    vertexAttrib4f: { 5: { numbers: [0, 1, 2, 3, 4] } },

    vertexAttrib1fv: { 2: { numbers: [0], arrays: [1] } },
    vertexAttrib2fv: { 2: { numbers: [0], arrays: [1] } },
    vertexAttrib3fv: { 2: { numbers: [0], arrays: [1] } },
    vertexAttrib4fv: { 2: { numbers: [0], arrays: [1] } },

    vertexAttribI4i: { 5: { numbers: [0, 1, 2, 3, 4] } }, // WebGL2
    vertexAttribI4iv: { 2: { numbers: [0], arrays: [1] } }, // WebGL2
    vertexAttribI4ui: { 5: { numbers: [0, 1, 2, 3, 4] } }, // WebGL2
    vertexAttribI4uiv: { 2: { numbers: [0], arrays: [1] } }, // WebGL2

    // QueryObjects

    beginQuery: { 2: { enums: [0] } }, // WebGL2
    endQuery: { 1: { enums: [0] } }, // WebGL2
    getQuery: { 2: { enums: [0, 1] } }, // WebGL2
    getQueryParameter: { 2: { enums: [1] } }, // WebGL2

    //  Sampler Objects

    samplerParameteri: { 3: { enums: [1] } }, // WebGL2
    samplerParameterf: { 3: { enums: [1] } }, // WebGL2
    getSamplerParameter: { 2: { enums: [1] } }, // WebGL2

    //  Sync objects

    clientWaitSync: {
      3: {
        enums: { 1: makeBitFieldToStringFunc(['SYNC_FLUSH_COMMANDS_BIT']) },
        numbers: [2],
      },
    }, // WebGL2
    fenceSync: { 2: { enums: [0] } }, // WebGL2
    getSyncParameter: { 2: { enums: [1] } }, // WebGL2

    //  Transform Feedback

    bindTransformFeedback: { 2: { enums: [0] } }, // WebGL2
    beginTransformFeedback: { 1: { enums: [0] } }, // WebGL2

    // Uniform Buffer Objects and Transform Feedback Buffers
    bindBufferBase: { 3: { enums: [0], numbers: [1] } }, // WebGL2
    bindBufferRange: { 5: { enums: [0], numbers: [1, 3, 4] } }, // WebGL2
    getIndexedParameter: { 2: { enums: [0], numbers: [1] } }, // WebGL2
    getActiveUniforms: { 3: { enums: [2] }, arrays: [1] }, // WebGL2
    getActiveUniformBlockParameter: { 3: { enums: [2], numbers: [1] } }, // WebGL2
    getActiveUniformBlockName: { 2: { numbers: [1] } }, // WebGL2
    transformFeedbackVaryings: { 3: { enums: [2] } }, // WebGL2
    uniformBlockBinding: { 3: { numbers: [1, 2] } }, // WebGL2
  }
  for (const [name, fnInfos] of Object.entries(glFunctionInfos)) {
    for (const fnInfo of Object.values(fnInfos)) {
      convertToObjectIfArray(fnInfo, 'enums')
      convertToObjectIfArray(fnInfo, 'numbers')
      convertToObjectIfArray(fnInfo, 'arrays')
    }
    if (/uniform(\d|Matrix)/.test(name)) {
      fnInfos.errorHelper = getUniformNameErrorMsg
    }
  }
  // Holds booleans for each GL error so after we get the error ourselves
  // we can still return it to the client app.
  const glErrorShadow = {}
  const origFuncs = {}

  function removeChecks() {
    for (const { ctx, origFuncs } of Object.values(apis)) {
      Object.assign(ctx, origFuncs)
      augmentedSet.delete(ctx)
    }
    for (const key of [...Object.keys(sharedState)]) {
      delete sharedState[key]
    }
  }

  function checkMaxDrawCallsAndZeroCount(gl, funcName, args) {
    const { vertCount, instances } = getDrawFunctionArgs(funcName, args)
    if (vertCount === 0) {
      console.warn(
        generateFunctionError(gl, funcName, args, `count for ${funcName} is 0!`)
      )
    }

    if (instances === 0) {
      console.warn(
        generateFunctionError(
          gl,
          funcName,
          args,
          `instanceCount for ${funcName} is 0!`
        )
      )
    }
    // console.log('draw calls', config.maxDrawCalls)
    --config.maxDrawCalls
    if (config.maxDrawCalls === 0) {
      removeChecks()
    }
  }

  function noop() {}

  function removeLinesFromStack(stack, linesToRemove) {
    const stackLines = stack.split('\n')

    const filteredStackLines = stackLines.slice(linesToRemove)

    return filteredStackLines.join('\n')
  }

  // I know ths is not a full check

  const VERTEX_ARRAY_BINDING = 0x85b5

  function getCurrentVertexArray() {
    const gl = baseContext
    return (typeof WebGL2RenderingContext !== 'undefined' &&
      gl instanceof WebGL2RenderingContext) ||
      apis.oes_vertex_array_object
      ? gl.getParameter(VERTEX_ARRAY_BINDING)
      : null
  }

  /*
  function getWebGLObject(gl, funcName, args, value) {
    const funcInfos = glFunctionInfos[funcName];
    if (funcInfos && funcInfos.bindHelper) {
      return funcInfos.bindHelper(gl, value);
    }
    const binding = bindPointMap.get(value);
    return binding ? gl.getParameter(binding) : null;
  }
  */

  function getWebGLObjectString(webglObject) {
    const name = webglObjectToNamesMap.get(webglObject) || '*unnamed*'
    return `${webglObject.constructor.name}(${quotedStringOrEmpty(name)})`
  }

  function getIndicesForBuffer(buffer) {
    return bufferToIndices.get(buffer)
  }

  /**
   * Returns the string version of a WebGL argument.
   * Attempts to convert enum arguments to strings.
   * @param {string} funcName the name of the WebGL function.
   * @param {number} numArgs the number of arguments passed to the function.
   * @param {number} argumentIndx the index of the argument.
   * @param {*} value The value of the argument.
   * @return {string} The value as a string.
   */
  function glFunctionArgToString(gl, funcName, numArgs, argumentIndex, value) {
    // there's apparently no easy to find out if something is a WebGLObject
    // as `WebGLObject` has been hidden. We could check all the types but lets
    // just check if the user mapped something
    const name = webglObjectToNamesMap.get(value)
    if (name) {
      return `${value.constructor.name}("${name}")`
    }
    if (value instanceof WebGLUniformLocation) {
      const name = locationsToNamesMap.get(value)
      return `WebGLUniformLocation("${name}")`
    }
    const funcInfos = glFunctionInfos[funcName]
    if (funcInfos !== undefined) {
      const funcInfo = funcInfos[numArgs]
      if (funcInfo !== undefined) {
        const argTypes = funcInfo.enums
        if (argTypes) {
          const argType = argTypes[argumentIndex]
          if (argType !== undefined) {
            if (typeof argType === 'function') {
              return argType(gl, value)
            } else {
              // is it a bind point
              //
              // I'm not sure what cases there are. At first I thought I'd
              // translate every enum representing a bind point into its corresponding
              // WebGLObject but that fails for `bindXXX` and for `framebufferTexture2D`'s
              // 3rd argument.
              //
              // Maybe it only works if it's not `bindXXX` and if its the first argument?
              //
              // issues:
              //   * bindBufferBase, bindBufferRange, indexed
              //
              // should we do something about these?
              //   O vertexAttrib, enable, vertex arrays implicit, buffer is implicit
              //       Example: could print
              //            'Error setting attrib 4 of WebGLVertexArrayObject("sphere") to WebGLBuffer("sphere positions")
              //   O drawBuffers implicit
              //       Example: 'Error trying to set drawBuffers on WebGLFrameBuffer('post-processing-fb)
              if (!funcName.startsWith('bind') && argumentIndex === 0) {
                const binding = getBindingQueryEnumForBindPoint(value)
                if (binding) {
                  const webglObject = gl.getParameter(binding)
                  if (webglObject) {
                    return `${glEnumToString(value)}{${getWebGLObjectString(
                      webglObject
                    )}}`
                  }
                }
              }
              return glEnumToString(value)
            }
          }
        }
      }
    }
    if (value === null) {
      return 'null'
    } else if (value === undefined) {
      return 'undefined'
    } else if (Array.isArray(value) || isTypedArray(value)) {
      if (value.length <= 32) {
        return `[${Array.from(value.slice(0, 32)).join(', ')}]`
      } else {
        return `${value.constructor.name}(${
          value.length !== undefined ? value.length : value.byteLength
        })`
      }
    } else {
      return value.toString()
    }
  }

  function checkTypedArray(ctx, funcName, args, arg, ndx, offset, length) {
    if (!isTypedArray(arg)) {
      reportFunctionError(
        ctx,
        funcName,
        args,
        `argument ${ndx} must be a TypedArray`
      )
      return
    }
    if (!isArrayThatCanHaveBadValues(arg)) {
      return
    }
    const start = offset
    const end = offset + length
    for (let i = start; i < end; ++i) {
      if (arg[i] === undefined) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `element ${i} of argument ${ndx} is undefined`
        )
        return
      } else if (isNaN(arg[i])) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `element ${i} of argument ${ndx} is NaN`
        )
        return
      }
    }
    return
  }

  function checkTypedArrayWithOffset(ctx, funcName, args, arg, ndx) {
    const offset = args[args.length - 1]
    const length = arg.length - offset
    checkTypedArray(ctx, funcName, args, arg, ndx, offset, length)
  }

  function checkBufferSource(ctx, funcName, args, arg, ndx) {
    if (isTypedArray(arg) && isArrayThatCanHaveBadValues(arg)) {
      const offset = 0
      const length = arg.length - offset
      checkTypedArray(ctx, funcName, args, arg, ndx, offset, length)
    } else {
      if (Array.isArray(arg)) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `argument ${ndx} is not an ArrayBufferView or ArrayBuffer`
        )
      }
    }
  }

  function checkBufferSourceWithOffset(ctx, funcName, args, arg, ndx) {
    if (isTypedArray(arg) && isArrayThatCanHaveBadValues(arg)) {
      const offset = args[args.length - 1]
      const length = arg.length - offset
      checkTypedArray(ctx, funcName, args, arg, ndx, offset, length)
    } else {
      if (Array.isArray(arg)) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `argument ${ndx} is not an ArrayBufferView or ArrayBuffer`
        )
      }
    }
  }

  function checkBufferSourceWithOffsetAndLength(ctx, funcName, args, arg, ndx) {
    if (isTypedArray(arg) && isArrayThatCanHaveBadValues(arg)) {
      const offset = args[args.length - 2]
      const length = args[args.length - 1]
      checkTypedArray(ctx, funcName, args, arg, ndx, offset, length)
    } else {
      if (Array.isArray(arg)) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `argument ${ndx} is not an ArrayBufferView or ArrayBuffer`
        )
      }
    }
  }

  function checkOptionalTypedArrayWithOffset(ctx, funcName, args, arg, ndx) {
    if (Array.isArray(arg) || isTypedArray(arg)) {
      const offset = args[args.length - 1]
      const length = arg.length - offset
      checkTypedArray(ctx, funcName, args, arg, ndx, offset, length)
    }
  }

  function checkArrayForUniformImpl(
    ctx,
    funcName,
    args,
    arg,
    ndx,
    offset,
    length,
    valuesPerElementFunctionRequires
  ) {
    const webglUniformLocation = args[0]
    if (!webglUniformLocation) {
      return
    }
    const uniformInfos = programToUniformInfoMap.get(sharedState.currentProgram)
    if (!uniformInfos) {
      return
    }
    // The uniform info type might be 'vec3' but they
    // might be calling uniform2fv. WebGL itself will catch that error but we might
    // report the wrong error here if we check for vec3 amount of data
    const name = locationsToNamesMap.get(webglUniformLocation)
    const { type, size, index } = uniformInfos.get(name)
    const valuesPerElementUniformRequires = getUniformTypeInfo(type).size
    if (valuesPerElementFunctionRequires !== valuesPerElementUniformRequires) {
      reportFunctionError(
        ctx,
        funcName,
        args,
        `uniform "${name}" is ${
          getUniformTypeInfo(type).name
        } which is wrong for ${funcName}`
      )
    }
    const maxElementsToReadFromArray = size - index
    const numElementsToCheck = Math.min(
      (length / valuesPerElementFunctionRequires) | 0,
      maxElementsToReadFromArray
    )
    const numValuesToCheck =
      numElementsToCheck * valuesPerElementFunctionRequires

    const start = offset
    const end = offset + numValuesToCheck
    for (let i = start; i < end; ++i) {
      if (arg[i] === undefined) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `element ${i} of argument ${ndx} is undefined`
        )
        return
      } else if (isArrayLike(arg[i])) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `element ${i} of argument ${ndx} is an array. WebGL expects flat arrays`
        )
        return
      } else if (isNaN(arg[i])) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `element ${i} of argument ${ndx} is NaN`
        )
        return
      }
    }
  }

  function checkArrayForUniformWithOffsetAndLength(
    valuesPerElementFunctionRequires
  ) {
    return function (ctx, funcName, args, arg, ndx) {
      const offset = args[args.length - 2]
      const length = args[args.length - 1]
      checkArrayForUniformImpl(
        ctx,
        funcName,
        args,
        arg,
        ndx,
        offset,
        length,
        valuesPerElementFunctionRequires
      )
    }
  }

  function checkArrayForUniformWithOffset(valuesPerElementFunctionRequires) {
    return function (ctx, funcName, args, arg, ndx) {
      const offset = args[args.length - 1]
      const length = arg.length - offset
      checkArrayForUniformImpl(
        ctx,
        funcName,
        args,
        arg,
        ndx,
        offset,
        length,
        valuesPerElementFunctionRequires
      )
    }
  }

  function checkArrayForUniform(valuesPerElementFunctionRequires) {
    return function (ctx, funcName, args, arg, ndx) {
      const offset = 0
      const length = arg.length
      checkArrayForUniformImpl(
        ctx,
        funcName,
        args,
        arg,
        ndx,
        offset,
        length,
        valuesPerElementFunctionRequires
      )
    }
  }

  /**
   * Converts the arguments of a WebGL function to a string.
   * Attempts to convert enum arguments to strings.
   *
   * @param {string} funcName the name of the WebGL function.
   * @param {number} args The arguments.
   * @return {string} The arguments as a string.
   */
  function glFunctionArgsToString(ctx, funcName, args) {
    const numArgs = args.length
    const stringifiedArgs = args.map(function (arg, ndx) {
      let str = glFunctionArgToString(ctx, funcName, numArgs, ndx, arg)
      // shorten because of long arrays
      if (str.length > 200) {
        str = str.substring(0, 200) + '...'
      }
      return str
    })
    return stringifiedArgs.join(', ')
  }

  function generateFunctionError(ctx, funcName, args, msg) {
    const gl = baseContext
    const msgs = [msg]
    const funcInfos = glFunctionInfos[funcName]
    if (funcInfos && funcInfos.errorHelper) {
      msgs.push(funcInfos.errorHelper(ctx, funcName, args, sharedState))
    }
    if (funcName.includes('draw')) {
      const program = gl.getParameter(gl.CURRENT_PROGRAM)
      if (!program) {
        msgs.push('no shader program in use!')
      } else {
        msgs.push(`with ${getWebGLObjectString(program)} as current program`)
      }
    }
    if (funcName.includes('vertexAttrib') || isDrawFunction(funcName)) {
      const vao = getCurrentVertexArray(ctx)
      const name = webglObjectToNamesMap.get(vao)
      const vaoName = `WebGLVertexArrayObject(${quotedStringOrEmpty(
        name || '*unnamed*'
      )})`
      msgs.push(`with ${vao ? vaoName : 'the default vertex array'} bound`)
    }
    const stringifiedArgs = glFunctionArgsToString(ctx, funcName, args)
    return `error in ${funcName}(${stringifiedArgs}): ${msgs.join('\n')}`
  }

  function reportFunctionError(ctx, funcName, args, msg) {
    const stack = removeLinesFromStack(new Error().stack, 1)
    const errorInfo = parseStack(stack)

    const errorEvent = new WebGLContextErrorEvent(
      {
        errorName: msg,
        error: generateFunctionError(ctx, funcName, args, msg),
        webglContext: ctx,
        functionName: funcName,
        args,
        errorInfo,
      }
      // Add any additional information here
    )
    ctx.canvas.dispatchEvent(errorEvent)
  }

  const isArrayLike = (a) => Array.isArray(a) || isTypedArray(a)

  function checkArgs(ctx, funcName, args) {
    const funcInfos = glFunctionInfos[funcName]
    if (funcInfos) {
      const funcInfo = funcInfos[args.length]
      if (!funcInfo) {
        reportFunctionError(
          ctx,
          funcName,
          args,
          `no version of function '${funcName}' takes ${args.length} arguments`
        )
        return
      } else {
        const { numbers = {}, arrays = {} } = funcInfo
        for (let ndx = 0; ndx < args.length; ++ndx) {
          const arg = args[ndx]
          // check the no arguments are undefined
          if (arg === undefined) {
            reportFunctionError(
              ctx,
              funcName,
              args,
              `argument ${ndx} is undefined`
            )
            return
          }
          if (numbers[ndx] !== undefined) {
            if (numbers[ndx] >= 0) {
              // check that argument that is number (positive) is a number
              if (
                (typeof arg !== 'number' &&
                  !(arg instanceof Number) &&
                  arg !== false &&
                  arg !== true) ||
                isNaN(arg)
              ) {
                reportFunctionError(
                  ctx,
                  funcName,
                  args,
                  `argument ${ndx} is not a number`
                )
                return
              }
            } else {
              // check that argument that maybe is a number (negative) is not NaN
              if (!(arg instanceof Object) && isNaN(arg)) {
                reportFunctionError(
                  ctx,
                  funcName,
                  args,
                  `argument ${ndx} is NaN`
                )
                return
              }
            }
          }
          // check that an argument that is supposed to be an array of numbers is an array and has no NaNs in the array and no undefined
          const arraySetting = arrays[ndx]
          if (arraySetting !== undefined) {
            const isArrayLike = Array.isArray(arg) || isTypedArray(arg)
            if (arraySetting >= 0) {
              if (!isArrayLike) {
                reportFunctionError(
                  ctx,
                  funcName,
                  args,
                  `argument ${ndx} is not am array or typedarray`
                )
                return
              }
            }
            if (isArrayLike && isArrayThatCanHaveBadValues(arg)) {
              if (typeof arraySetting === 'function') {
                arraySetting(ctx, funcName, args, arg, ndx)
              } else {
                for (let i = 0; i < arg.length; ++i) {
                  if (arg[i] === undefined) {
                    reportFunctionError(
                      ctx,
                      funcName,
                      args,
                      `element ${i} of argument ${ndx} is undefined`
                    )
                    return
                  } else if (isNaN(arg[i])) {
                    reportFunctionError(
                      ctx,
                      funcName,
                      args,
                      `element ${i} of argument ${ndx} is NaN`
                    )
                    return
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const extraWrappers = {
    getExtension(ctx, propertyName) {
      const origFn = ctx[propertyName]
      ctx[propertyName] = function (...args) {
        const extensionName = args[0].toLowerCase()
        const api = apis[extensionName]
        if (api) {
          return api.ctx
        }
        const ext = origFn.call(ctx, ...args)
        if (ext) {
          augmentAPI(ext, extensionName, { ...options, origGLErrorFn })
        }
        return ext
      }
    },
  }

  // Makes a function that calls a WebGL function and then calls getError.
  function makeErrorWrapper(ctx, funcName) {
    const origFn = ctx[funcName]
    const postCheck = postChecks[funcName] || noop

    ctx[funcName] = function (...args) {
      checkArgs(ctx, funcName, args)
      if (sharedState.currentProgram && isDrawFunction(funcName)) {
        const msgs = checkAttributesForBufferOverflow(
          baseContext,
          funcName,
          args,
          getWebGLObjectString,
          getIndicesForBuffer
        )
        if (msgs.length) {
          reportFunctionError(ctx, funcName, args, msgs.join('\n'))
        }
      }
      const result = origFn.call(ctx, ...args)
      const gl = baseContext
      const err = origGLErrorFn.call(gl)
      if (err !== 0) {
        glErrorShadow[err] = true
        const msgs = [glEnumToString(err)]
        if (isDrawFunction(funcName)) {
          if (sharedState.currentProgram) {
            msgs.push(...checkFramebufferFeedback(gl, getWebGLObjectString))
          }
        }
        reportFunctionError(ctx, funcName, args, msgs.join('\n'))
      } else {
        postCheck(ctx, funcName, args, result)
      }
      return result
    }
  }

  // Wrap each function
  for (const propertyName in ctx) {
    if (typeof ctx[propertyName] === 'function') {
      origFuncs[propertyName] = ctx[propertyName]
      makeErrorWrapper(ctx, propertyName)
    }
  }

  // Override the getError function with one that returns our saved results.
  if (ctx.getError) {
    ctx.getError = function () {
      for (const err of Object.keys(glErrorShadow)) {
        if (glErrorShadow[err]) {
          glErrorShadow[err] = false
          return err
        }
      }
      return ctx.NO_ERROR
    }
  }

  apis[nameOfClass.toLowerCase()] = { ctx, origFuncs }

  return sharedState
}
