import * as ws from "ws";

let server: ws.Server;
let client: ws.WebSocket;

export function createServer(host: string = "0.0.0.0", port: number = 1145) {
	server = new ws.WebSocketServer({
		port: 1145,
	});
	server.on("connection", (c) => {
		client = c;
		console.log("[Websocket] connected");
		run(`tellraw @a {"rawtext":[{"text":"[§bmcpack devtools§r] connected"}]}`);
	});
	console.log(
		`WSServer running on wss://${host}:${port}.\nType "/connect ${host}:${port}" to connect.`
	);
}

async function run(cmd: string) {
	server.clients.forEach((c) => {
		c.send(
			JSON.stringify({
				body: {
					origin: {
						type: "player",
					},
					commandLine: cmd,
					version: 1,
				},
				header: {
					requestId: "00000000-0000-0000-0000-000000000000",
					messagePurpose: "commandRequest",
					version: 1,
					messageType: "commandRequest",
				},
			})
		);
	});
}

export let runCommand = run;
