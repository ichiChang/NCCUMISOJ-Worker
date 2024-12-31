// agent.js
import WebSocket from "ws";
import { v4 as uuidv4 } from 'uuid';
import Runner from './runner.js';
import { languageConfigs } from "./config/config.js";

class Agent {
    constructor(wServerUrl, config = {}) {
        this.id = uuidv4();
        this.wServerUrl = wServerUrl;  // 保存 URL 供重連使用
        this.config = {
            maxCPU: config.maxCPU || 4,
            maxMemory: config.maxMemory || 4096
        };

        // 追蹤資源使用
        this.resources = {
            usedCPU: 0,
            usedMemory: 0
        };

        // 追蹤執行中的任務
        this.activeTasks = new Map();
        
        // 連接狀態追蹤
        this.ws = null;
        this.isConnecting = false;
        
        // 開始首次連接
        this.connect();
    }
    connect() {
        // 避免重複連接
        if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) {
            return;
        }

        this.isConnecting = true;
        console.log('Attempting to connect to WebSocket server...');

        try {
            this.ws = new WebSocket(this.wServerUrl);
            this.setupWebSocket();
        } catch (error) {
            console.error('Connection attempt failed:', error);
            this.scheduleReconnect();
        }
    }

    setupWebSocket() {
        this.ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
            this.scheduleReconnect();
        });

        this.ws.onopen = () => {
            console.log('Connected to Web Server');
            this.isConnecting = false;
            
            // 連接成功後發送註冊資訊
            this.sendMessage({
                type: 'register',
                resources: {
                    cpu: this.config.maxCPU,
                    memory: this.config.maxMemory
                }
            });
        };

        this.ws.onclose = () => {
            console.log('Disconnected from Web Server');
            this.scheduleReconnect();
        };

        this.ws.onmessage = this.handleMessage.bind(this);
    }

    scheduleReconnect() {
        this.isConnecting = false;
        console.log('Scheduling reconnection in 10 seconds...');
        setTimeout(() => this.connect(), 10000);  // 10 秒後重試
    }

    async handleMessage(event) {
        try {
            const message = JSON.parse(event.data);
            console.log('Received task:', message);

            if (message.type === 'task') {
                await this.startTask(message.task);
            }
        } catch (error) {
            console.error('Error handling message:', error);
            this.sendMessage({
                type: 'error',
                error: error.message
            });
        }
    }

    async startTask(task) {
        const langConfig = languageConfigs[task.language];
        const startTime = Date.now();
        
        // 更新資源使用
        this.resources.usedCPU += langConfig.cpuLimit;
        this.resources.usedMemory += langConfig.memoryLimit;
        
        // 開始執行時回報資源使用
        this.sendMessage({
            type: 'resourceUpdate',
            metrics: {
                cpu: {
                    total: this.config.maxCPU,
                    used: this.resources.usedCPU
                },
                memory: {
                    total: this.config.maxMemory,
                    used: this.resources.usedMemory
                }
            }
        });
     
        try {
            const runner = new Runner();
            const result = await runner.run(task);
     
            // 釋放資源
            this.resources.usedCPU -= langConfig.cpuLimit;
            this.resources.usedMemory -= langConfig.memoryLimit;
     
            // 發送結果與釋放後的資源狀態
            this.sendMessage({
                type: 'taskComplete',
                taskId: task.id,
                result: result,
                metrics: {
                    executionTime: Date.now() - startTime,
                    language: task.language,
                    resources: {
                        cpu: {
                            total: this.config.maxCPU,
                            used: this.resources.usedCPU
                        },
                        memory: {
                            total: this.config.maxMemory, 
                            used: this.resources.usedMemory
                        }
                    },
                    langConfig: {
                        cpuLimit: langConfig.cpuLimit,
                        memoryLimit: langConfig.memoryLimit,
                        timeout: langConfig.timeout,
                        image: langConfig.image,
                        fileExtension: langConfig.fileExtension,
                        runCommand: langConfig.runCommand
                    }
                }
            });
        } catch (error) {
            // 釋放資源
            this.resources.usedCPU -= langConfig.cpuLimit;
            this.resources.usedMemory -= langConfig.memoryLimit;
     
            // 發送錯誤與釋放後的資源狀態
            this.sendMessage({
                type: 'taskError',
                taskId: task.id,
                error: error.message,
                language: task.language,
                resources: {
                    cpu: {
                        total: this.config.maxCPU,
                        used: this.resources.usedCPU
                    },
                    memory: {
                        total: this.config.maxMemory,
                        used: this.resources.usedMemory
                    }
                }
            });
        }
     }

    sendMessage(message) {
        if (this.ws.readyState === WebSocket.OPEN) {
            const fullMessage = {
                ...message,
                agentId: this.id,
                timestamp: Date.now()
            };
            console.log('Sending message:', fullMessage);
            this.ws.send(JSON.stringify(fullMessage));
        }
    }
}

// 啟動 agent
const WS_URL = process.env.WS_URL || 'ws://localhost:4000';
console.log('Starting agent with configuration:', {
    url: WS_URL,
    cpu: process.env.MAX_CPU || 4,
    memory: process.env.MAX_MEMORY || 4096
});

const agent = new Agent(WS_URL, {
    maxCPU: parseInt(process.env.MAX_CPU) || 4,
    maxMemory: parseInt(process.env.MAX_MEMORY) || 4096
});

export default Agent;