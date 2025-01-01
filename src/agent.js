// agent.js
import WebSocket from "ws";
import { v4 as uuidv4 } from 'uuid';
import Docker from 'dockerode';
import Runner from './runner.js';
import { languageConfigs } from "./config/config.js";

class Agent {
    constructor(wServerUrl) {
        this.id = uuidv4();
        this.wServerUrl = wServerUrl;  // 保存 URL 供重連使用
        this.docker = new Docker();

        // 追蹤執行中的任務
        this.activeTasks = new Map();
        
        // 連接狀態追蹤
        this.ws = null;
        this.isConnecting = false;
        
        // 開始首次連接
        this.connect();
    }

    async getDockerStats() {
        try {
            // 獲取 Docker 系統信息
            const info = await this.docker.info();
            
            // 獲取所有運行中的容器
            const containers = await this.docker.listContainers();
            const containerStats = await Promise.all(
                containers.map(container => this.docker.getContainer(container.Id).stats({ stream: false }))
            );
            
            let totalCPUUsage = 0;
            let totalMemoryUsage = 0;

            for (const stats of containerStats) {
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - 
                                stats.precpu_stats.cpu_usage.total_usage;
                const systemCpuDelta = stats.cpu_stats.system_cpu_usage - 
                                     stats.precpu_stats.system_cpu_usage;
                const numberOfCPUs = stats.cpu_stats.online_cpus;
                
                if (systemCpuDelta > 0 && numberOfCPUs > 0) {
                    const cpuUsage = (cpuDelta / systemCpuDelta) * numberOfCPUs;
                    totalCPUUsage += cpuUsage;
                }

                if (stats.memory_stats.usage) {
                    totalMemoryUsage += stats.memory_stats.usage;
                }
            }

            return {
                total: {
                    cpu: info.NCPU,
                    memory: Math.round(info.MemTotal / (1024 * 1024))  // 轉換為 MB
                },
                used: {
                    cpu: parseFloat(totalCPUUsage.toFixed(2)),
                    memory: Math.round(totalMemoryUsage / (1024 * 1024))  // 轉換為 MB
                }
            };
        } catch (error) {
            console.error('Error getting Docker stats:', error);
            throw error;
        }
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

        this.ws.onopen = async () => {
            console.log('Connected to Web Server');
            this.isConnecting = false;
            
            // 連接成功後發送註冊資訊
            const stats = await this.getDockerStats();
            this.sendMessage({
                type: 'register',
                resources: {
                    cpu: stats.total.cpu,
                    memory: stats.total.memory
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
        setTimeout(() => this.connect(), 1000);  // 1 秒後重試
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
        
        // 取得目前資源使用量
        const preStats = await this.getDockerStats();
        
        // 回報資源使用
        this.sendMessage({
            type: 'resourceUpdate',
            metrics: {
                cpu: {
                    total: preStats.total.cpu,
                    used: preStats.used.cpu + langConfig.cpuLimit
                },
                memory: {
                    total: preStats.total.memory,
                    used: preStats.used.memory + langConfig.memoryLimit
                }
            }
        });
     
        try {
            const runner = new Runner();
            const result = await runner.run(task);
     
            // 取得最新的資源使用量
            const postStats = await this.getDockerStats();
     
            this.sendMessage({
                type: 'taskComplete',
                taskId: task.id,
                result: result,
                metrics: {
                    executionTime: Date.now() - startTime,
                    language: task.language,
                    resources: {
                        cpu: {
                            total: postStats.total.cpu,
                            used: postStats.used.cpu
                        },
                        memory: {
                            total: postStats.total.memory,
                            used: postStats.used.memory
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
            // 取得最新的資源使用量
            const errorStats = await this.getDockerStats();
            
            this.sendMessage({
                type: 'taskError',
                taskId: task.id,
                error: error.message,
                language: task.language,
                resources: {
                    cpu: {
                        total: errorStats.total.cpu,
                        used: errorStats.used.cpu
                    },
                    memory: {
                        total: errorStats.total.memory,
                        used: errorStats.used.memory
                    }
                }
            });
        } finally {
            // 取得最終資源使用量並回報
            const finalStats = await this.getDockerStats();
            this.sendMessage({
                type: 'resourceUpdate',
                metrics: {
                    cpu: {
                        total: finalStats.total.cpu,
                        used: finalStats.used.cpu
                    },
                    memory: {
                        total: finalStats.total.memory,
                        used: finalStats.used.memory
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
const WS_URL = 'wss://api.nccumisoj.online/ws';
console.log('Starting agent with WebSocket URL:', WS_URL);
const agent = new Agent(WS_URL);

export default Agent;