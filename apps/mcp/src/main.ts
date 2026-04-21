#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { buildHubMcpServer } from './tools.js'

const server = buildHubMcpServer()
const transport = new StdioServerTransport()
await server.connect(transport)
