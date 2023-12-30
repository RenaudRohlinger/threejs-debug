# threejs-debug
- Based on [webgl-lint](https://github.com/greggman/webgl-lint)

### Installation:
`npm i threejs-debug`

Or

`import { threejsDebug } from 'https://cdn.jsdelivr.net/npm/threejs-debug@0.0.1/dist/threejs-debug.mjs'`

### Usage:
```js
import { threejsDebug } from 'threejs-debug';

threejsDebug( scene, renderer, {
    maxDrawCalls: 10000,
} )
```



### Configuration

You don't need to configure anything to use in general but there are some settings
for special needs.

- `maxDrawCalls` (default: 1000)

  Turns off the checking after this many draw calls. Set to 0 to check forever.

- `failUnsetUniforms`: (default: true)

  Checks that you set uniforms except for samplers and fails if you didn't.
  It's a common error to forget to set a uniform or to mis-spell the name of
  a uniform and therefore not set the real one. The common exception is
  samplers because uniforms default to 0 so not setting a sampler means use
  texture unit 0 so samplers are not checked.

  Of course maybe you're not initializing some uniforms on purpose
  so you can turn off this check. I'd recommend setting them so you get the
  benefit of this check finding errors.

  Note: uniform blocks are not checked directly. They are checked by WebGL itself
  in the sense that if you fail to provide uniform buffers for your uniform blocks
  you'll get an error but there is no easy way to check that you set them.

- `failUnsetSamplerUniforms`: (default: false)

  See above why sampler uniforms are not checked by default. You can force them
  to be checked by this setting.

- `failZeroMatrixUniforms`: (default: true)

  Checks that a uniform matrix is not all zeros. It's a common source of errors to
  forget to set a matrix to the identity and it seems uncommon to have an all
  zero matrix. If you have a reason a matrix needs to be all zeros you may want
  to turn this off.

- `failUnrenderableTextures`: (default: true)

  Unrenderable textures are not an error in WebGL, they just don't render.
  WebGL itself usually print's a warning but it's usually fairly cryptic
  just telling you an unrenderable texture exists but not much else.

  Examples of unrenderable textures are non-power of 2 textures in WebGL1
  with filtering set to need mips and wrap not set to `CLAMP_TO_EDGE` or
  in both WebGL and WebGL2 would be mips of different internal formats
  or the wrong size.

- `failUndefinedUniforms`: (default: false)

  WebGL by default returns `null` when you call `gl.getUniformLocation` for
  a uniform that does not exist. It then silently ignores calling `gl.uniformXXX`
  if the location is `null`. This is great when you're editing a shader in that
  if you remove a uniform from the shader your code that is still setting
  the old uniform will keep working.

  For example if you are debugging and you go to the bottom of your fragment
  shader and add `gl_FragColor = vec4(1, 0, 0, 1);` all the uniforms in your
  fragment shader will be optimized out. If WebGL suddenly issues errors trying
  to set those it would be much more frustrating to debug. Conversely though, if
  you have a typo, for example you want to look up the location of `'u_color'` and
  you type `gl.getUniformLocation(prg, 'uColor')` you'll get no error and it
  will likely take you a while to find your typo.

  So, by default webgl-lint only prints a warning for undefined uniforms.
  You can make throw by setting `failUndefinedUniforms` to `true`.

- `failBadShadersAndPrograms`: (default: true)

  Most WebGL programs expect all shaders to compile and all programs
  to link but often programmers don't check for errors. While it's likely
  they'd get an error about a bad program further in their code, at that point
  it's likely too late to tell them it's because the program didn't compile or
  link. Instead the message will just be something like "no valid program in use".

  If you're working on a project that expects shaders to fail to compile
  and/or programs to link you can set this to `false`.

- `warnUndefinedUniforms`: (default: true)

  See `failUndefinedUniforms`. Setting this to false turns off warnings
  about undefined uniforms.

- `ignoreUniforms`: (default: [])

  Lets you configure certain uniforms not to be checked. This way you can turn
  off checking for certain uniforms if they don't obey the rules above and still
  keep the rules on for other uniforms. This configuration is additive. In other words

  ```js
  ext.setConfiguration({ ignoreUniforms: ['foo', 'bar'] })
  ext.setConfiguration({ ignoreUniforms: ['baz'] })
  ```

  Ignores uniforms called 'foo', 'bar', and 'baz'.

- `throwOnError`: (default: true)

  The default is to throw an exception on error. This has several benefits.

  1. It encourages you to fix the bug.

  2. You'll get a stack trace which you can drill down to find the bug.

  3. If you use "pause on exception" in your browser's dev tools you'll
     get a live stack trace where you can explore all the local variables
     and state of your program.

  But, there might be times when you can't avoid the error, say you're
  running a 3rd party library that gets errors. You should go politely
  ask them to fix the bug or better, fix it yourself and send them a pull request.
  In any case, if you just want it to print an error instead of throw then
  you can set `throwOnError` to false.

- `makeDefaultTags`: (default: true)

  If true, all objects get a default tag, Example `*UNTAGGED:Buffer1`,
  `*UNTAGGED:Buffer2` etc. This is a minor convenience to have something
  to distinguish one object from another though it's highly recommended
  you tag your objects. (See naming).

  The only reason to turn this off is if you're creating and deleting
  lots of objects and you want to make sure tags are not leaking memory
  since tags are never deleted automatically. (See "naming).

