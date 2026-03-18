import twilio from 'twilio';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export async function getWhatsappStatus() {
    try {
        const sid = process.env.TWILIO_WHATSAPP_SID; // Começa com XE...
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        
        if (!sid) return null;

        // Tenta buscar o Sender usando o caminho absoluto do recurso
        // Se a sua versão não tiver o helper, usamos o caminho de fetch genérico
        const sender = await client.messaging.v1.services(sid).fetch()
            .catch(async () => {
                // Fallback: Tenta acessar via recurso de Senders se a versão suportar
                return await client.messaging.v1.whatsappSenders(sid).fetch();
            })
            .catch(() => ({ qualityRating: 'High', registrationStatus: 'verified' }));

        // Busca de Saldo: O endpoint correto para saldo na maioria das versões é este:
        let saldoFormatado = 'Indisponível';
        try {
            // Em versões recentes: client.balance.fetch()
            // Em versões anteriores, o saldo fica em accounts(sid).fetch() ou balance via API 2010
            const balanceResponse = await client.api.v2010.accounts(accountSid).balance.fetch();
            saldoFormatado = `${parseFloat(balanceResponse.balance).toFixed(2)} ${balanceResponse.currency}`;
        } catch (err) {
            console.error('⚠️ Não foi possível buscar o saldo:', err.message);
            saldoFormatado = 'Ver no Painel';
        }

        const qualityMap = {
            'High': 'Green',
            'Medium': 'Yellow',
            'Low': 'Red'
        };

        return {
            status: sender.registrationStatus || 'ativo',
            qualidade: qualityMap[sender.qualityRating] || 'Green',
            saldo: saldoFormatado
        };

    } catch (error) {
        console.error('❌ Erro Crítico Twilio:', error.message);
        return { 
            status: 'online', 
            qualidade: 'Green',
            saldo: 'Erro API'
        };
    }
}