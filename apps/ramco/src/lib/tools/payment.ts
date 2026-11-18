/**
 * Payment Tools
 *
 * Tools for payment health analysis, aging reports, and collection tracking.
 */

import type { ToolHandler, ToolResult } from '../types/mcp';
import type { RamcoClient } from '../ramco-client-v2';
import { fetchAllRecords } from '../bulk-operations';

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Analyze payment status across entire membership with aging and delinquency rates
 */
export const analyzePaymentHealthTool: ToolHandler = async (
  args: any,
  ramcoClient: RamcoClient,
  associationId?: string
): Promise<ToolResult> => {
  // Fetch all invoices and payments
  const invoices = await fetchAllRecords(ramcoClient, {
    entity: 'invoice',
    fields: ['InvoiceId', 'ContactId', 'TotalAmount', 'AmountDue', 'DueDate', 'StatusCode'],
    maxRecords: 5000
  });

  const payments = await fetchAllRecords(ramcoClient, {
    entity: 'cobalt_payment',
    fields: ['cobalt_paymentid', 'cobalt_contactid', 'cobalt_amount', 'createdon'],
    maxRecords: 5000
  });

  // Calculate payment metrics
  const totalOutstanding = invoices.reduce((sum, inv) =>
    sum + (inv.AmountDue?.Value || 0), 0
  );

  const overdueInvoices = invoices.filter(inv => {
    const dueDate = new Date(inv.DueDate?.Value || inv.DueDate);
    return dueDate < new Date() && (inv.AmountDue?.Value || 0) > 0;
  });

  // Aging analysis
  const aging = {
    current: 0,
    thirtyDays: 0,
    sixtyDays: 0,
    ninetyDays: 0,
    overNinety: 0
  };

  const now = new Date();
  overdueInvoices.forEach(inv => {
    const dueDate = new Date(inv.DueDate?.Value || inv.DueDate);
    const daysPast = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
    const amount = inv.AmountDue?.Value || 0;

    if (daysPast <= 0) aging.current += amount;
    else if (daysPast <= 30) aging.thirtyDays += amount;
    else if (daysPast <= 60) aging.sixtyDays += amount;
    else if (daysPast <= 90) aging.ninetyDays += amount;
    else aging.overNinety += amount;
  });

  let responseText = `💰 **Payment Health Analysis**\n\n`;
  responseText += `**Overview:**\n`;
  responseText += `• Total Invoices: ${invoices.length}\n`;
  responseText += `• Total Outstanding: $${totalOutstanding.toLocaleString()}\n`;
  responseText += `• Overdue Invoices: ${overdueInvoices.length}\n`;
  responseText += `• Collection Rate: ${((1 - overdueInvoices.length / invoices.length) * 100).toFixed(1)}%\n`;

  responseText += `\n**Aging Analysis:**\n`;
  responseText += `• Current: $${aging.current.toLocaleString()}\n`;
  responseText += `• 1-30 Days: $${aging.thirtyDays.toLocaleString()}\n`;
  responseText += `• 31-60 Days: $${aging.sixtyDays.toLocaleString()}\n`;
  responseText += `• 61-90 Days: $${aging.ninetyDays.toLocaleString()}\n`;
  responseText += `• Over 90 Days: $${aging.overNinety.toLocaleString()} ⚠️\n`;

  responseText += `\n**Payment Trends (Last 30 Days):**\n`;
  const recentPayments = payments.filter(p => {
    const payDate = new Date(p.createdon?.Value || p.CreatedOn);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return payDate > thirtyDaysAgo;
  });

  const recentTotal = recentPayments.reduce((sum, p) =>
    sum + (p.cobalt_amount?.Value || 0), 0
  );
  responseText += `• Payments Received: ${recentPayments.length}\n`;
  responseText += `• Total Collected: $${recentTotal.toLocaleString()}\n`;
  responseText += `• Average Payment: $${(recentTotal / recentPayments.length || 0).toFixed(2)}\n`;

  responseText += `\n**Action Items:**\n`;
  if (aging.overNinety > 0) {
    responseText += `• 🔴 Immediate collection action needed for $${aging.overNinety.toLocaleString()} (90+ days)\n`;
  }
  if (aging.sixtyDays > 0) {
    responseText += `• 🟡 Follow up on $${aging.sixtyDays.toLocaleString()} (60+ days)\n`;
  }
  responseText += `• Consider payment plans for members with large outstanding balances\n`;

  return {
    content: [{
      type: "text",
      text: responseText
    }]
  };
};
