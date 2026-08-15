import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn 컴포넌트가 클래스를 합칠 때 쓰는 헬퍼. 뒤에 오는 클래스가 이긴다. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
