import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();
export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export const ZERO = new D(0);
