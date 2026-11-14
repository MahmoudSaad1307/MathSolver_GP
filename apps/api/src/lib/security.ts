import crypto from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { CODE_ALPHABET } from '@mathlens/shared';
import type { AppEnv } from '../config/env.js';

export interface TeacherAccessClaims {
  sub: string;
  email: string;
  role: 'TEACHER';
  type: 'teacher_access';
}

export interface StudentSessionClaims {
  sub: string;
  cohortId: string;
  accountId?: string;
  email?: string;
  type: 'student_session';
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function hashIp(ip: string | undefined, salt: string): string {
  return sha256Hex(`${salt}:${ip ?? 'unknown'}`);
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function generateUnambiguousCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export function signTeacherAccessToken(
  user: { id: string; email: string; role: 'TEACHER' },
  env: AppEnv,
): string {
  const payload: TeacherAccessClaims = {
    sub: user.id,
    email: user.email,
    role: user.role,
    type: 'teacher_access',
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
}

export function verifyTeacherAccessToken(token: string, env: AppEnv): TeacherAccessClaims | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      decoded.type === 'teacher_access' &&
      typeof decoded.sub === 'string' &&
      typeof decoded.email === 'string'
    ) {
      return decoded as TeacherAccessClaims;
    }
    return null;
  } catch {
    return null;
  }
}

export function signStudentSessionToken(
  student: { id: string; cohortId: string; accountId?: string; email?: string },
  env: AppEnv,
): string {
  const payload: StudentSessionClaims = {
    sub: student.id,
    cohortId: student.cohortId,
    ...(student.accountId ? { accountId: student.accountId } : {}),
    ...(student.email ? { email: student.email } : {}),
    type: 'student_session',
  };
  return jwt.sign(payload, env.STUDENT_JWT_SECRET, { expiresIn: '12h' });
}

export function verifyStudentSessionToken(token: string, env: AppEnv): StudentSessionClaims | null {
  try {
    const decoded = jwt.verify(token, env.STUDENT_JWT_SECRET);
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      decoded.type === 'student_session' &&
      typeof decoded.sub === 'string' &&
      typeof decoded.cohortId === 'string'
    ) {
      return decoded as StudentSessionClaims;
    }
    return null;
  } catch {
    return null;
  }
}

export function signVideoUnlock(
  studentId: string,
  topicId: string,
  unlockedAtIso: string,
  secret: string,
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${studentId}:${topicId}:${unlockedAtIso}`)
    .digest('hex');
}
