import fs from 'fs'
import { join } from 'path'
import { fusebox, sparky, pluginLink, pluginReplace } from 'fuse-box'
import { IDevServerProps } from 'fuse-box/devServer/devServerProps'
import { Context as FuseBoxContext } from 'fuse-box/core/context'
import { wrapContents } from 'fuse-box/plugins/pluginStrings'
import { minify as luamin } from 'luamin'
import { IPublicConfig } from 'fuse-box/config/IConfig'
import { IRunResponse } from 'fuse-box/core/IRunResponse'
import { IRunProps } from 'fuse-box/config/IRunProps'

const port = Number(process.env.PORT) || 8080

const p = (p: string): string => join(__dirname, p)

const TEMPLATE_PATH = p('../src/index.html')

class Context {
    public readonly paths = {
        dist: p('../dist'),
    }
    public runDev(runProps?: IRunProps): Promise<IRunResponse> {
        return fusebox(this.getConfig(true)).runDev(runProps)
    }
    public runProd(runProps?: IRunProps): Promise<IRunResponse> {
        return fusebox(this.getConfig()).runProd(runProps)
    }
    private getConfig(runServer = false): IPublicConfig {
        return {
            compilerOptions: {
                tsConfig: p('../tsconfig.json'),
            },
            entry: p('../src/index.ts'),
            target: 'browser',
            webIndex: { template: TEMPLATE_PATH },
            devServer: runServer && this.getServerConfig(),
            resources: {
                resourcePublicRoot: '/assets',
            },
            plugins: [
                this.luaPlugin,
                pluginLink(/basis_transcoder\.(js|wasm)$/, { useDefault: true }),
                pluginReplace({
                    __CORS_PROXY_URL__: runServer
                        ? 'https://api.allorigins.win/raw?url='
                        : '/corsproxy?url=',
                    __STATIC_URL__: runServer
                        ? '/data'
                        : 'https://static-fbe.teoxoy.com/file/factorio-blueprint-editor',
                }),
            ],
            cache: { enabled: runServer, strategy: 'memory' },
            hmr: { plugin: p('./hmr.ts') },
            sourceMap: {
                css: !runServer,
                project: true,
                vendor: false,
            },
            watcher: {
                root: [p('../src'), p('../../editor/src')],
            },
        }
    }
    private getServerConfig(): IDevServerProps {
        return {
            httpServer: { port },
            hmrServer: { port },
            proxy: [
                {
                    path: '/data',
                    options: {
                        target: `http://localhost:8888`,
                        // pathRewrite: { '^/api': '' },
                    },
                },
            ],
        }
    }
    private readonly luaPlugin = (ctx: FuseBoxContext): void => {
        ctx.ict.on('bundle_resolve_module', props => {
            const m = props.module
            if (!m.captured && m.extension === '.lua') {
                m.captured = true
                m.read()
                m.contents = wrapContents(`\`${luamin(m.contents)}\``, true)
            }
            return props
        })
    }
}

const { rm, task } = sparky(Context)

task('dev', async ctx => {
    rm(ctx.paths.dist)
    await ctx.runDev({
        bundles: { distRoot: ctx.paths.dist },
    })
})

task('build', async ctx => {
    const original = fs.readFileSync(TEMPLATE_PATH, { encoding: 'utf8' })
    const mod = original.replace(
        '__ANALYTICS_SCRIPT__',
        `<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "5698d7914edb4ab1bb0c61acbe3dab3d"}'></script><!-- End Cloudflare Web Analytics -->`
    )
    fs.writeFileSync(TEMPLATE_PATH, mod)

    rm(ctx.paths.dist)
    await ctx.runProd({
        bundles: {
            distRoot: ctx.paths.dist,
            app: 'js/app.$hash.js',
            vendor: 'js/vendor.$hash.js',
            styles: 'css/styles.$hash.css',
        },
    })

    fs.writeFileSync(TEMPLATE_PATH, original)
})
