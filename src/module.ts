import {
  defineNuxtModule,
  resolveModule,
  addServerMiddleware,
  Nuxt,
  addPlugin,
  installModule,
  useNuxt,
  addTemplate,
  extendWebpackConfig
} from '@nuxt/kit'
import { NitroContext } from '@nuxt/nitro'
import { resolve } from 'upath'
import { joinURL } from 'ufo'
import { DocusOptions } from './types'
import { useNuxtIgnoreList } from './utils/ignore'
import { defaultContext } from './context'
import setupDevTarget from './module.dev'

export const resolveApiRoute = (route: string) => {
  const nuxt = useNuxt()
  const apiBase = nuxt.options.content?.apiBase || '_docus'
  return joinURL('/api', apiBase, route)
}

export default defineNuxtModule((nuxt: Nuxt) => ({
  defaults: {
    apiBase: '_docus',
    watch: nuxt.options.dev,
    database: {
      provider: 'lokijs'
    }
  },
  configKey: 'content',
  setup(options: DocusOptions, nuxt: Nuxt) {
    // Install @nuxt/bridge
    installModule(nuxt, {
      src: resolveModule('@nuxt/bridge'),
      options: {
        externals: {
          inline: ['@docus/core']
        }
      }
    })

    // Extend context
    const docusContext = defaultContext

    // Add root page into generate routes
    nuxt.options.generate.routes = nuxt.options.generate.routes || []
    nuxt.options.generate.routes.push('/')

    extendWebpackConfig(config => {
      config?.module?.rules.unshift({
        test: /\.mjs$/,
        type: 'javascript/auto',
        include: [/node_modules/]
      })
    })

    // Transpile @docus/mdc
    nuxt.options.build.transpile.push(
      '@docus/mdc',
      'unctx',
      'unified',
      'bail',
      'trough',
      'parse-entities',
      'character-entities',
      'character-reference-invalid',
      'is-decimal',
      'is-hexadecimal',
      'is-alphanumerical',
      'is-alphabetical',
      'detab',
      'emoticon',
      'space-separated-tokens',
      'is-absolute-url',
      'ccount',
      'markdown-table',
      'comma-separated-tokens',
      'web-namespaces',
      'zwitch',
      'html-void-elements',
      'mdurl',
      'parse5',
      /(unist|remark|mdast|micromark|rehype|hast)-?.*/
    )

    // Setup runtime alias
    const runtimeDir = resolve(__dirname, 'runtime')
    nuxt.options.alias['~docus/content'] = runtimeDir
    nuxt.options.alias['~docus/database'] = resolve(runtimeDir, `database/providers/${options.database.provider}`)

    // Register API
    nuxt.hook('nitro:context', async (ctx: NitroContext) => {
      ctx.storage.mounts.content = {
        driver: 'fs',
        driverOptions: {
          base: resolve(nuxt.options.srcDir, 'content'),
          ignore: await useNuxtIgnoreList(nuxt)
        }
      }
    })

    // Add a server middleware for each API functions
    for (const api of ['get', 'list', 'search', 'navigation']) {
      addServerMiddleware({
        route: resolveApiRoute(api),
        handle: resolveModule(`./server/api/${api}`, { paths: runtimeDir })
      })
    }

    // Set publicRuntimeConfig $docus key
    ;(nuxt.options.publicRuntimeConfig as any).$docus = {
      apiBase: options.apiBase
    }

    // Add Docus runtime plugin
    addPlugin(resolve(__dirname, './templates/content'))

    // Add Docus context template
    for (const target of ['server', 'client']) {
      addTemplate({
        src: resolve(__dirname, './templates/context.js'),
        filename: `docus/context.${target}.mjs`,
        options: {
          target,
          context: docusContext
        }
      })
    }

    // Setup dev target
    if (nuxt.options.dev) {
      setupDevTarget(options, nuxt)

      if (options.watch) {
        // Add reload API
        addServerMiddleware({
          route: `/api/${options.apiBase}/reload`,
          handle: resolveModule('./server/api/reload', { paths: runtimeDir })
        })

        // Add Hot plugin
        addPlugin(resolve(__dirname, './templates/hot'))
      }
    }

    // Call docus:context hook
    nuxt.hook('modules:done', () => nuxt.callHook('docus:context', docusContext))

    /**
     * Register props component handler
     * Props component uses Nuxt Components dirs to find and process component
     **/
    nuxt.hook('components:dirs', dirs => {
      // Push local default Docus components
      dirs.push({
        path: resolve(__dirname, 'runtime/components'),
        prefix: '',
        isAsync: false,
        level: 998
      })

      const paths = []

      // Update context: component dirs
      paths.push(
        ...dirs.map((dir: any) => {
          if (typeof dir === 'string') return dir
          if (typeof dir === 'object') return dir.path
          return ''
        })
      )

      // Push components directories paths into Markdown transformer
      docusContext.transformers.markdown.components?.push({
        name: 'props',
        path: resolveModule('./runtime/transformers/markdown/loaders/props', { paths: __dirname }),
        target: 'server',
        options: { paths }
      })
    })
  }
}))