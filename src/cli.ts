#! /usr/bin/env node
import { execSync } from "child_process";
import esbuild, { BuildOptions, Format } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import parseArg from "minimist";
import watch from "node-watch";
import path, { resolve } from "path";
import { Zip } from "zip-lib";
import * as wss from "./wss";

export const mcbuild_version = "1.0.0-beta";

const argv = parseArg(process.argv);
export interface MCBuildWSServerOptions {
	host: string;
	port: number;
}
export interface MCBuildConfig {
	packName?: string;
	mode?: "dev" | "release";
	outFile?: string;
	lang?: "ts" | "js";
	entry?: string;
	type?: "bp" | "addon" | "world";
	esbuildOptions?: esbuild.BuildOptions;
	server?: MCBuildWSServerOptions;
	mcdir?: string;
	beforeBuild?: () => void;
	afterBuild?: () => void;
}

const mbConfig: MCBuildConfig = {
	packName: "unknown",
	mode: "dev",
	lang: "ts",
	outFile: "main.js",
	entry: resolve("./src/index.ts"),
};
if (existsSync(resolve("mcbuild.config.js")))
	Object.assign(mbConfig, require(resolve(argv.c ?? "mcbuild.config.js")));

const args = Object.assign(mbConfig, argv);
const subcommand = args._[2] as string;
const dirname = __dirname;

console.log("MCBuild v" + mcbuild_version, subcommand);

if (args.mode == "dev" && subcommand == "watch") {
	wss.createServer(args.server?.host, args.server?.port);
}

const worldDir = args.packName ?? "world";
const mcdir =
	args.mcdir ??
	`${process.env["localappdata"]}\\Packages\\Microsoft.MinecraftUWP_8wekyb3d8bbwe\\LocalState\\games\\com.mojang\\`;
const bpPath =
	args.mode == "dev" && subcommand == "watch"
		? path.join(mcdir, "development_behavior_packs/" + args.packName)
		: resolve("./build/bp/" + args.packName);
const rpPath =
	args.mode == "dev" && subcommand == "watch"
		? path.join(mcdir, "development_resource_packs/" + args.packName)
		: resolve("./build/rp/" + args.packName);

async function compress(output: string, content: string) {
	const zip = new Zip();
	zip.addFolder(path.resolve(content));
	await zip.archive(output).then(
		() => {
			console.log(`> Compressed: ${content} -> ${output}`);
		},
		(e) => {
			console.error(`Compressed file failed to be created at ${output} : ${e}`);
		}
	);
}

function cleanIfExists(p: string) {
	if (existsSync(p)) {
		rmSync(p, { recursive: true });
	}
	mkdirSync(p, { recursive: true });
}

const config: BuildOptions = {
	sourcemap: args.mode == "dev",
	entryPoints: [args.entry ?? "./src/index.ts"],
	minify: !(args.mode == "dev"),
	bundle: true,
	external: [
		"@minecraft/server",
		"@minecraft/server-ui",
		"@minecraft/server-editor",
	],
	format: "esm",
	define: {
		isDevMode: args.mode == "dev" ? "true" : "false",
		BUILD_ID: `"${process.env["BUILD_ID"] ?? "DEV"}"`,
	},
	outfile: resolve(path.join(bpPath, `scripts/${args.outFile}.js`)),
	plugins: [
		{
			name: "mcpack",
			setup(build) {
				let buildTimes = 0;
				let startTime = 0;
				build.onStart(() => {
					args.beforeBuild?.();
					startTime = new Date().getTime();
					cleanIfExists(resolve("./build"));
					if (
						subcommand == "build" ||
						(subcommand == "watch" && buildTimes == 0)
					) {
						console.log("> Clean");
						cleanIfExists(bpPath);
						if (args.type == "addon" || args.type == "world")
							cleanIfExists(rpPath);
						console.log("> Copy data");
						cpSync(resolve("./behavior_packs/" + args.packName), bpPath, {
							recursive: true,
						});
						if (args.type == "addon" || args.type == "world")
							cpSync(resolve("./resource_packs/" + args.packName), rpPath, {
								recursive: true,
							});
					}
					if (args.release && args.type == "world") {
						console.log("> Copy world");
						cpSync(resolve("./world"), resolve("./build/world"), {
							recursive: true,
						});
						cpSync(resolve("./world_template"), resolve("./build/world"), {
							recursive: true,
						});
					}
				});
				build.onEnd(async (r) => {
					if (r.errors.length == 0) {
						args.afterBuild?.();
						if (subcommand == "build" && args.release) {
							try {
								if (args.type == "world") {
									cpSync(
										bpPath,
										resolve("./build/world/behavior_packs/" + args.packName),
										{
											recursive: true,
										}
									);
									cpSync(
										rpPath,
										resolve("./build/world/resource_packs/" + args.packName),
										{
											recursive: true,
										}
									);
									await compress(
										resolve(`./dist/${args.packName}.mcworld`),
										resolve("./build/world")
									);
									await compress(
										resolve(`./dist/${args.packName}.mctemplate`),
										resolve("./build/world")
									);
								}

								await compress(
									resolve(`./dist/${args.packName}_bp.mcpack`),
									bpPath
								);
								if (args.type == "addon" || args.type == "world")
									await compress(
										resolve(`./dist/${args.packName}_rp.mcpack`),
										rpPath
									);
							} catch (e) {
								console.error(e);
							}
						}
						buildTimes++;
						console.log(
							`\x1b[1;32mBuilt in ${new Date().getTime() - startTime}ms\x1b[0m`
						);
						await wss.runCommand("reload");
						await wss.runCommand(
							`tellraw @a {"rawtext":[{"text":"[§bmcpack devtools§r] reloaded"}]}`
						);
					} else {
						console.log(
							`\x1b[1;31mBuild failed. ${r.errors.length} errors found.\x1b[0m`
						);
					}
				});
			},
		},
	],
};

async function fetchMCPackageVersion(p: string) {
	let pkg = JSON.parse(readFileSync(resolve("package.json")).toString());
	const registry = await (
		await fetch("https://registry.npmjs.org/" + p)
	).json();
	const versions = Object.keys(registry.versions);
	let beta_stable = versions.filter((v) => /.*-beta.*-stable/.test(v));
	let latest = beta_stable[beta_stable.length - 1];
	let latest_version = latest.match(/.*-beta\.(.*)-stable/)?.[1];
	let latest_id = latest.match(/(.*-beta).*-stable/)?.[1];
	console.log(
		`\x1b[1;35mPackage: ${p}\x1b[0m\n\x1b[1;32mDependency version: \x1b[0m`,
		latest,
		"\n\x1b[1;32mMinecraft version: \x1b[0m",
		latest_version,
		"\n\x1b[1;32mManifest detail: \x1b[0m",
		latest_id,
		"\n\x1b[1;34mCurrent: \x1b[0m",
		pkg.dependencies[p],
		"\n"
	);
	return `${p}@${latest}`;
}
const subcommands: Record<string, () => void> = {
	build: async () => {
		esbuild.build(config as unknown as Format).catch((e) => undefined);
	},
	watch: async () => {
		const ctx = await esbuild.context(config);
		await ctx.watch();
		watch(resolve("./behavior_packs/" + args.packName), { recursive: true }).on(
			"change",
			(e, fn) => {
				const relpath = path.relative(
					resolve("./behavior_packs/" + args.packName),
					fn.toString()
				);
				if (e == "update") {
					cpSync(fn.toString(), path.join(bpPath, relpath), {
						recursive: true,
					});
					console.log("[\x1b[1;34mupdate\x1b[0m] BP\\", relpath);
				} else {
					rmSync(path.join(bpPath, relpath), { recursive: true });
					console.log("[\x1b[1;31mremove\x1b[0m] BP\\", relpath);
				}
			}
		);
		if (args.type == "addon" || args.type == "world")
			watch(resolve("./resource_packs/" + args.packName), {
				recursive: true,
			}).on("change", (e, fn) => {
				const relpath = path.relative(
					resolve("./resource_packs/" + args.packName),
					fn.toString()
				);
				if (e == "update") {
					cpSync(fn.toString(), path.join(rpPath, relpath), {
						recursive: true,
					});
					console.log("[\x1b[1;34mupdate\x1b[0m] RP\\", relpath);
				} else {
					rmSync(path.join(rpPath, relpath), { recursive: true });
					console.log("[\x1b[1;31mremove\x1b[0m] RP\\", relpath);
				}
			});
		console.log("\x1b[1;32mWatching for file changes...\x1b[0m");
	},
	"sync-world": () => {
		if (args.type != "world") throw new Error("The mode isn't 'world'");
		if (existsSync(path.join(mcdir, "minecraftWorlds", worldDir))) {
			cpSync(
				path.join(mcdir, "minecraftWorlds", worldDir),
				resolve("./world"),
				{ recursive: true }
			);
		} else {
			cpSync(
				resolve("./world"),
				path.join(mcdir, "minecraftWorlds", worldDir),
				{ recursive: true }
			);
		}
	},
	"override-world"() {
		cpSync(resolve("./world"), path.join(mcdir, "minecraftWorlds", worldDir), {
			recursive: true,
		});
	},
	"check-update": async () => {
		let v = [
			await fetchMCPackageVersion("@minecraft/server"),
			await fetchMCPackageVersion("@minecraft/server-ui"),
		];
		console.log(`\x1b[1mRun 'npm i ${v.join(" ")} --force' to update\x1b[0m`);
	},
	help() {
		console.log("mcbuild\n ", Object.keys(subcommands).join("\n  "));
	},
};

if (subcommands[subcommand]) {
	subcommands[subcommand]();
} else {
	console.error("Invalid subcommand. Available commands:");
	subcommands["help"]();
	process.exitCode = 1;
}
