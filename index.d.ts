import * as esbuild from "esbuild";

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
