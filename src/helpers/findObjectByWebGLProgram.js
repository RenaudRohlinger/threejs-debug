function findObjectByWebGLProgram(scene, renderer, webglProgram) {
  let foundObject = null

  scene.traverse((object) => {
    if (foundObject === null && object.material) {
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material]

      for (const material of materials) {
        const materialProperties = renderer.properties.get(material)
        if (
          materialProperties.currentProgram &&
          materialProperties.currentProgram.program === webglProgram
        ) {
          foundObject = object
          break
        }
      }
    }
  })

  return foundObject
}

export { findObjectByWebGLProgram }
