import * as net from 'net';
import { Client } from './Client';
import { PacketRouter } from '../network/packetRouter';
import { Config } from './config';
import { GlobalState } from './GlobalState';

export class GameServer {
    private server: net.Server;
    private port: number;
    private host: string;
    private router: PacketRouter;
    private readonly sockets = new Set<net.Socket>();

    constructor(port: number = 8080, router: PacketRouter, host: string = Config.BIND_HOST) {
        this.port = port;
        this.router = router;
        this.host = host;
        this.server = net.createServer((socket) => this.handleConnection(socket));
        this.server.on('error', (error) => {
            const socketError = error as NodeJS.ErrnoException;
            if (socketError.code === 'EADDRINUSE') {
                console.error(
                    `[GameServer] Cannot listen on ${this.host}:${this.port} because the port is already in use.`
                );
                console.error('[GameServer] Stop the previous dev server or change GAME_PORT before restarting.');
                process.exitCode = 1;
                setImmediate(() => process.exit(1));
                return;
            }

            console.error('[GameServer] Server error:', error);
        });
    }

    public start(): void {
        this.server.listen(this.port, this.host, () => {
            console.log(`[GameServer] Listening on ${this.host}:${this.port}`);
        });
    }

    public isListening(): boolean {
        return this.server.listening;
    }

    public stop(): Promise<void> {
        if (!this.server.listening) {
            return Promise.resolve();
        }

        for (const socket of this.sockets) socket.end();
        const forceClose = setTimeout(() => {
            for (const socket of this.sockets) socket.destroy();
        }, 5_000);
        forceClose.unref?.();

        return new Promise((resolve, reject) => {
            this.server.close((error) => {
                clearTimeout(forceClose);
                if (error) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private handleConnection(socket: net.Socket): void {
        // Create Client wrapper
        socket.setNoDelay(true);
        socket.setKeepAlive(true);
        const client = new Client(socket, this.router);
        GlobalState.clients.add(client);
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
        const addr = `${socket.remoteAddress}:${socket.remotePort}`;
        console.log(`[GameServer] Client connected: ${addr}`);
    }
}
