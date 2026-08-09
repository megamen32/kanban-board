'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import type { ConflictInfo } from '@/lib/kanban/types';

interface Props {
  conflict: ConflictInfo;
  onResolve: (useServer: boolean) => void;
}

export function ConflictDialog({ conflict, onResolve }: Props) {
  return (
    <Dialog open={true} onOpenChange={() => onResolve(true)}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Конфликт версий
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Карточка <strong>{conflict.clientCard.title}</strong> была изменена
            одновременно в файловой системе и в браузере.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-1">Сервер (файл) v{conflict.serverVersion}</div>
              <div className="font-medium">{conflict.serverCard.title}</div>
              <div className="text-xs text-muted-foreground mt-1">Обновлена: {new Date(conflict.serverCard.updated).toLocaleString('ru')}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground mb-1">Браузер v{conflict.clientVersion}</div>
              <div className="font-medium">{conflict.clientCard.title}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Какую версию сохранить? Другая версия не будет потеряна — она остаётся в файловой системе.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve(false)}>
            Использовать мою (v{conflict.clientVersion})
          </Button>
          <Button onClick={() => onResolve(true)}>
            Использовать серверную (v{conflict.serverVersion})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}