// runner.js
import Docker from 'dockerode';
import { promises as fs } from 'fs';
import path from 'path';
import config from './config/config.js';
import { testTemplates } from './testTemplates.js';

class Runner {
    constructor() {
        this.docker = new Docker();
    }

    async run(task) {
        const { language, code, testCases } = task;
        console.log(`[Runner] Starting test execution for ${language}`);
        
        const langConfig = config.languages[language];
        if (!langConfig) {
            console.error(`[Runner] Unsupported language: ${language}`);
            throw new Error(`Unsupported language: ${language}`);
        }

        let executionDir;
        try {
            executionDir = await this.prepareFiles(language, code, testCases);

            
            const files = await fs.readdir(executionDir);
            for (const file of files) {
                const content = await fs.readFile(path.join(executionDir, file), 'utf8');
            }

            if (language === 'java') {
                await this.compileJava(executionDir, langConfig);
            }

            const container = await this.createContainer(language, executionDir);

            return await this.executeTests(container, langConfig.timeout);
        } catch (error) {
            throw error;
        } finally {
            if (executionDir) {
                await fs.rm(executionDir, { recursive: true, force: true }).catch(err => {
                    console.error(`[Runner] Cleanup error:`, err);
                });
            }
        }
    }

    async prepareFiles(language, code, testCases) {
        const langConfig = config.languages[language];
        const executionId = `${Date.now()}-${Math.random().toString(36).substring(7)}`;  // 加入隨機字串確保唯一性
        const executionDir = path.resolve(process.cwd(), config.system.workDir, executionId);
    
        console.log(`[Runner] Creating execution directory: ${executionDir}`);
        await fs.mkdir(executionDir, { recursive: true });
    
        if (language === 'python') {
            const solutionPath = path.join(executionDir, 'solution.py');
            const testPath = path.join(executionDir, 'test.py');
            console.log(`[Runner] Writing Python files to ${executionDir}`);
            
            await fs.writeFile(solutionPath, code);
            const testContent = testTemplates[language].replace(
                '{{TEST_CASES}}',
                JSON.stringify(testCases)
            );
            await fs.writeFile(testPath, testContent);
    
            // 確認檔案已寫入
            const files = await fs.readdir(executionDir);
            console.log(`[Runner] Created files in ${executionDir}:`, files);
    
        } else if (language === 'javascript') {
            const solutionPath = path.join(executionDir, 'solution.js');
            const testPath = path.join(executionDir, 'test.js');
            console.log(`[Runner] Writing JavaScript files to ${executionDir}`);
            
            await fs.writeFile(solutionPath, code);
            const testContent = testTemplates[language].replace(
                '{{TEST_CASES}}',
                JSON.stringify(testCases)
            );
            await fs.writeFile(testPath, testContent);
    
            // 確認檔案已寫入
            const files = await fs.readdir(executionDir);
            console.log(`[Runner] Created files in ${executionDir}:`, files);
        }
    
        return executionDir;
    }

    async createContainer(language, executionDir) {
        const langConfig = config.languages[language];
        
        console.log(`[Runner] Container configuration:`, {
            Image: langConfig.image,
            WorkingDir: '/code',
            Cmd: [...langConfig.runCommand, `test${langConfig.fileExtension}`],
            HostConfig: {
                Binds: [`${executionDir}:/code`],
                Memory: langConfig.memoryLimit * 1024 * 1024,
                NanoCPUs: Math.floor(langConfig.cpuLimit * 1e9)
            }
        });

        const container = await this.docker.createContainer({
            Image: langConfig.image,
            WorkingDir: '/code',
            Cmd: [...langConfig.runCommand, `test${langConfig.fileExtension}`],
            HostConfig: {
                Binds: [`${executionDir}:/code`],
                Memory: langConfig.memoryLimit * 1024 * 1024,
                NanoCPUs: Math.floor(langConfig.cpuLimit * 1e9),
                ...config.system.containerDefaults
            }
        });

        return container;
    }

    async executeTests(container, timeout) {
        try {
            await container.start();
            
            const stream = await container.logs({
                stdout: true,
                stderr: true,
                follow: true
            });

            const results = await new Promise((resolve, reject) => {
                let finalResults = null;

                let buffer = '';
                const timeoutId = setTimeout(() => {
                    if (!finalResults) {
                        console.log('[Runner] Execution timeout');
                        reject(new Error('Execution timeout'));
                    }
                }, timeout);

                stream.on('data', chunk => {
                    // 處理 Docker 輸出中的特殊字元
                    const data = chunk.toString().replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F]/g, '');
                    
                    // 嘗試分割和解析每一行
                    const lines = (buffer + data).split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        if (!trimmedLine) continue;
                        
                        try {
                            // 移除任何非 JSON 的前綴字符
                            const jsonStr = trimmedLine.replace(/^[^{]*/, '');
                            const result = JSON.parse(jsonStr);
                            
                            if (result.type === 'final_result') {
                                console.log('[Runner] Final results received');
                                finalResults = {
                                    success: result.data.failed === 0,
                                    total: result.data.total,
                                    passed: result.data.passed,
                                    failed: result.data.failed,
                                    cases: result.data.cases,
                                    execution_time: result.data.execution_time
                                };
                            }
                        } catch (e) {
                            console.log('[Runner] Parse error for line:', trimmedLine);
                        }
                    }
                });

                
                container.wait((err, data) => {
                    clearTimeout(timeoutId);
                    
                    if (err) {
                        reject(err);
                    } else if (data.StatusCode !== 0) {
                        reject(new Error(`Container exited with code ${data.StatusCode}`));
                    } else if (finalResults) {
                        resolve(finalResults);
                    } else {
                        reject(new Error('No test results received'));
                    }
                });

                stream.on('error', error => {
                    console.error('[Runner] Stream error:', error);
                    clearTimeout(timeoutId);
                    reject(error);
                });
            });

            return results;

        } catch (error) {
            console.error('[Runner] Execution error:', error);
            throw error;
        } finally {
            try {
                await container.stop().catch(() => {});
                await container.remove().catch(() => {});
            } catch (e) {
                console.log('[Runner] Cleanup error:', e);
            }
        }
    }
}

export default Runner;