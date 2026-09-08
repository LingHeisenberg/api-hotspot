export const permissions = ['dashboard.view','payments.view','payments.export','payments.manage','receipts.view','receipts.download','reports.view','reports.export','vouchers.view','vouchers.generate','vouchers.sync','packages.view','packages.edit','connections.view','connections.disconnect','system.view','users.view','users.create','users.edit','users.disable','roles.view','roles.manage','audit.view','mikrotik.view','mikrotik.manage','settings.view','settings.manage'];
export const roleDefaults = {
  SUPER_ADMIN: permissions,
  ADMIN: permissions.filter(p => !p.startsWith('roles.') && !p.startsWith('users.') && !p.startsWith('settings.') && !p.startsWith('mikrotik.manage')),
  FINANCEIRO: ['dashboard.view','payments.view','payments.export','receipts.view','receipts.download','reports.view','reports.export'],
  OPERADOR: ['payments.view','vouchers.view','packages.view','connections.view'],
  SUPORTE: ['payments.view','vouchers.view','connections.view','mikrotik.view','system.view'],
  AUDITOR: ['dashboard.view','payments.view','receipts.view','reports.view','audit.view']
};
