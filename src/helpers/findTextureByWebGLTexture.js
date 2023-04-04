function findTextureByWebGLTexture(scene, renderer) {
  let foundTexture = null
  const gl = renderer.getContext()
  const isWebGL2 = gl instanceof WebGL2RenderingContext

  const textureTargets = [
    { target: gl.TEXTURE_2D, paramName: gl.TEXTURE_BINDING_2D },
    {
      target: gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
    {
      target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
    {
      target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
    {
      target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
    {
      target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
    {
      target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
      paramName: gl.TEXTURE_BINDING_CUBE_MAP,
    },
  ]

  if (isWebGL2) {
    textureTargets.push(
      {
        target: gl.TEXTURE_2D_ARRAY,
        paramName: gl.TEXTURE_BINDING_2D_ARRAY,
      },
      { target: gl.TEXTURE_3D, paramName: gl.TEXTURE_BINDING_3D }
    )
  }

  function checkTextures(object, material) {
    for (const property in material) {
      const value = material[property]
      if (value?.isTexture) {
        const textureProperties = renderer.properties.get(value)

        const isMatchingTexture = textureTargets.some(
          ({ target, paramName }) => {
            // gl.activeTexture(gl.TEXTURE0)
            // gl.bindTexture(target, textureProperties.__webglTexture)
            return (
              textureProperties.__webglTexture === gl.getParameter(paramName)
            )
          }
        )

        if (textureProperties && isMatchingTexture) {
          foundTexture = {
            type: 'property',
            value,
            object,
            material,
            property,
          }
        }
      }
    }

    if (material.uniforms) {
      for (const uniform in material.uniforms) {
        const uniformValue = material.uniforms[uniform].value
        if (uniformValue?.isTexture) {
          const textureProperties = renderer.properties.get(uniformValue)

          const isMatchingTexture = textureTargets.some(
            ({ target, paramName }) => {
              // gl.activeTexture(gl.TEXTURE0)
              // gl.bindTexture(target, textureProperties.__webglTexture)
              return (
                textureProperties.__webglTexture === gl.getParameter(paramName)
              )
            }
          )

          if (textureProperties && isMatchingTexture) {
            // New check for framebuffers

            foundTexture = {
              type: 'uniform',
              value: uniformValue,
              object,
              material,
              property: uniform,
            }
          }
        }
      }
    }
  }

  scene.traverse((object) => {
    if (foundTexture === null && object.material) {
      if (Array.isArray(object.material)) {
        for (const material of object.material) {
          checkTextures(object, material)
        }
      } else {
        checkTextures(object, object.material)
      }
    }
  })

  return foundTexture
}

export { findTextureByWebGLTexture }
