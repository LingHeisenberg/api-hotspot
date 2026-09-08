import readline from 'node:readline/promises';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { passwordSchema, transaction, audit } from '../admin/common.js';

const rl=readline.createInterface({input:process.stdin,output:process.stdout});
async function hiddenPassword() {
  if(!process.stdin.isTTY) throw new Error('Use um terminal interativo para introduzir a password.');
  rl.close(); process.stdout.write('Password (mínimo 12 caracteres): '); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let value='';
    const done=()=>{process.stdin.setRawMode(false);process.stdin.off('data',listener);process.stdin.pause();process.stdout.write('\n');};
    const listener=chunk=>{for(const char of chunk.toString()) {
      if(char==='\u0003') {done();reject(new Error('Cancelado.'));return;}
      if(char==='\r'||char==='\n') {done();resolve(value);return;}
      if(char==='\u007f'||char==='\b') value=value.slice(0,-1); else value+=char;
    }};process.stdin.on('data',listener);
  });
}
try {
  const name=z.string().min(2).max(100).parse(await rl.question('Nome: '));
  const username=z.string().regex(/^[a-zA-Z0-9_.-]{3,60}$/).parse(await rl.question('Username: '));
  const email=z.string().email().max(190).parse(await rl.question('Email: '));
  const password=passwordSchema.parse(await hiddenPassword());
  await transaction(async c=>{
    const [[role]]=await c.execute("SELECT id FROM roles WHERE name='SUPER_ADMIN'");
    if(!role) throw new Error('Execute npm run admin:migrate primeiro.');
    const [r]=await c.execute('INSERT INTO admin_users(name,username,email,password_hash,role_id) VALUES (?,?,?,?,?)',[name,username,email,await bcrypt.hash(password,12),role.id]);
    await audit({headers:{}},'CREATE_ADMIN_CLI','users',r.insertId,null,{name,username,email,role:'SUPER_ADMIN'},c);
  });console.log('Super Admin criado.');
} catch(e) {console.error(e instanceof z.ZodError?'Dados inválidos: nome, username, email ou password.': e.code==='ER_DUP_ENTRY'?'Username ou email já existe.':'Não foi possível criar administrador. Confirme a migration e o acesso MySQL.');process.exitCode=1;}
finally {rl.close();await pool.end();}
