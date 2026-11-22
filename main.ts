import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OPS: Record<number, [string, number, number, number]> = {
  0x00: ['HALT', 0, 0, 0],
  0x01: ['PUSH8', 1, 0, 1],
  0x02: ['PUSH32', 4, 0, 1],
  0x03: ['POP', 0, 1, 0],
  0x04: ['DUP', 0, 1, 2],
  0x05: ['SWAP', 0, 2, 2],
  0x06: ['OVER', 0, 2, 3],
  0x07: ['ROT', 0, 3, 3],
  0x10: ['ADD', 0, 2, 1],
  0x11: ['SUB', 0, 2, 1],
  0x12: ['MUL', 0, 2, 1],
  0x13: ['DIV', 0, 2, 1],
  0x14: ['MOD', 0, 2, 1],
  0x15: ['DIVU', 0, 2, 1],
  0x16: ['MODU', 0, 2, 1],
  0x17: ['NEG', 0, 1, 1],
  0x18: ['AND', 0, 2, 1],
  0x19: ['OR', 0, 2, 1],
  0x1a: ['XOR', 0, 2, 1],
  0x1b: ['NOT', 0, 1, 1],
  0x1c: ['SHL', 0, 2, 1],
  0x1d: ['SHR', 0, 2, 1],
  0x1e: ['SHRU', 0, 2, 1],
  0x20: ['EQ', 0, 2, 1],
  0x21: ['LT', 0, 2, 1],
  0x22: ['LTU', 0, 2, 1],
  0x30: ['JMP', 2, 0, 0],
  0x31: ['JZ', 2, 1, 0],
  0x32: ['JNZ', 2, 1, 0],
  0x33: ['CALL', 2, 0, 0],
  0x34: ['RET', 0, 0, 0],
  0x40: ['LOAD', 0, 1, 1],
  0x41: ['STORE', 0, 2, 0],
  0x50: ['PRINT', 0, 1, 0],
  0x51: ['PUTC', 0, 1, 0],
  0x52: ['IN', 0, 0, 1],
  0x53: ['EXIT', 0, 1, 0],
};

const enc = new TextEncoder();

export function run(program: Uint8Array, input: Uint8Array): { stdout: Uint8Array; exit: number } {
  const n = program.length;
  const D = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let csp = 0;
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let olen = 0;
  let inPos = 0;
  let pc = 0;
  let steps = 0;

  const done = (exit: number) => ({ stdout: out.subarray(0, olen), exit });

  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = OPS[program[pc]];
    if (!op) return done(5);
    const [name, imm, pops, pushes] = op;
    if (pc + imm >= n) return done(9);
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return done(2);
    if (sp - pops + pushes > 256) return done(3);
    pc = next;

    switch (name) {
      case 'HALT':
        return done(0);
      case 'PUSH8':
        D[sp++] = (program[next - 1] << 24) >> 24;
        break;
      case 'PUSH32':
        D[sp++] = program[next - 4] | (program[next - 3] << 8) | (program[next - 2] << 16) | (program[next - 1] << 24);
        break;
      case 'POP':
        sp--;
        break;
      case 'DUP':
        D[sp] = D[sp - 1];
        sp++;
        break;
      case 'SWAP': {
        const t = D[sp - 1];
        D[sp - 1] = D[sp - 2];
        D[sp - 2] = t;
        break;
      }
      case 'OVER':
        D[sp] = D[sp - 2];
        sp++;
        break;
      case 'ROT': {
        const a = D[sp - 3];
        D[sp - 3] = D[sp - 2];
        D[sp - 2] = D[sp - 1];
        D[sp - 1] = a;
        break;
      }
      case 'NEG':
        D[sp - 1] = (-D[sp - 1]) | 0;
        break;
      case 'NOT':
        D[sp - 1] = ~D[sp - 1];
        break;
      case 'ADD':
      case 'SUB':
      case 'MUL':
      case 'DIV':
      case 'MOD':
      case 'DIVU':
      case 'MODU':
      case 'AND':
      case 'OR':
      case 'XOR':
      case 'SHL':
      case 'SHR':
      case 'SHRU':
      case 'EQ':
      case 'LT':
      case 'LTU': {
        const b = D[sp - 1];
        const a = D[sp - 2];
        let r: number;
        switch (name) {
          case 'ADD':
            r = (a + b) | 0;
            break;
          case 'SUB':
            r = (a - b) | 0;
            break;
          case 'MUL':
            r = Math.imul(a, b);
            break;
          case 'DIV':
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0;
            break;
          case 'MOD':
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0;
            break;
          case 'DIVU':
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
            break;
          case 'MODU':
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0;
            break;
          case 'AND':
            r = a & b;
            break;
          case 'OR':
            r = a | b;
            break;
          case 'XOR':
            r = a ^ b;
            break;
          case 'SHL':
            r = a << (b & 31);
            break;
          case 'SHR':
            r = a >> (b & 31);
            break;
          case 'SHRU':
            r = (a >>> (b & 31)) | 0;
            break;
          case 'EQ':
            r = a === b ? 1 : 0;
            break;
          case 'LT':
            r = a < b ? 1 : 0;
            break;
          case 'LTU':
            r = (a >>> 0) < (b >>> 0) ? 1 : 0;
            break;
          default:
            r = 0;
        }
        sp -= 2;
        D[sp++] = r;
        break;
      }
      case 'JMP':
      case 'JZ':
      case 'JNZ': {
        const rel = ((program[next - 2] | (program[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (name !== 'JMP') {
          const v = D[--sp];
          take = name === 'JZ' ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 'CALL':
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = program[next - 2] | (program[next - 1] << 8);
        break;
      case 'RET':
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 'LOAD': {
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 'STORE': {
        const addr = D[sp - 1];
        const v = D[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2;
        M[addr] = v;
        break;
      }
      case 'PRINT': {
        const bytes = enc.encode(String(D[sp - 1]));
        if (olen + bytes.length > 65536) return done(11);
        sp--;
        out.set(bytes, olen);
        olen += bytes.length;
        break;
      }
      case 'PUTC':
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 'IN':
        D[sp++] = inPos < input.length ? input[inPos++] : -1;
        break;
      case 'EXIT':
        return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const p = readFileSync(join(I, id, 'program.bin'));
  const inp = readFileSync(join(I, id, 'input.bin'));
  const r = run(new Uint8Array(p), new Uint8Array(inp));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.stdout);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
