import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'electron', 'flow-native-host.cs');
const outputDir = path.join(root, 'build', 'runtime', 'flow-native-host');
const output = path.join(outputDir, 'kaoz-flow-native-host.exe');
const candidates = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
];
const compiler = candidates.find(file => fs.existsSync(file));
if (!compiler) throw new Error('Compilador C# do Windows não encontrado para preparar a ponte do Chrome.');
fs.mkdirSync(outputDir, { recursive: true });
execFileSync(compiler, ['/nologo', '/target:exe', '/optimize+', `/out:${output}`, '/r:System.Web.Extensions.dll', source], { stdio: 'inherit' });
if (!fs.existsSync(output) || fs.statSync(output).size === 0) throw new Error('A ponte nativa do Chrome não foi gerada.');
console.log(`Ponte nativa do Chrome preparada em ${output}`);
