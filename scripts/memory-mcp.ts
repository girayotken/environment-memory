import {serveStdio} from '@modelcontextprotocol/server/stdio';
import {createMemoryMcpServer,localMemoryOrigin} from '../src/server/agent-memory-mcp.ts';
const base=localMemoryOrigin(process.env.ENVIRONMENT_MEMORY_URL??'http://127.0.0.1:7430');
serveStdio(()=>createMemoryMcpServer(base));
