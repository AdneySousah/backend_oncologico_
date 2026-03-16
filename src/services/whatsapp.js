import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';


const isDocker = process.env.NODE_ENV === 'production';
let newClient = null;

// 1. Instanciamos o client no escopo global do arquivo

if (!isDocker) {

    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });
    newClient = client
} else {


    const client = new Client({
        authStrategy: new LocalAuth(),
        dataPath: './.wwebjs_auth',
        puppeteer: {
            // No Docker, não passamos o caminho do Windows. 
            // O Puppeteer encontrará o Chromium instalado no Linux automaticamente.
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Importante para evitar crash em containers
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ],
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        }
    });
    newClient = client
}

// 2. Configuramos os eventos
newClient.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo com o seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

newClient.on('ready', () => {
    console.log('🤖 WhatsApp Bot conectado e pronto para enviar mensagens!');
});

// 3. Inicializamos o client
newClient.initialize();

// 4. Exportamos a função que vai USAR o client instanciado lá em cima
export const enviarMensagemWhatsApp = async (numero, mensagem) => {
    try {
        // Validação de estado: evita o erro de 'evaluate' em null
        if (!newClient || !newClient.info || !newClient.info.wid) {
            console.error('❌ O cliente WhatsApp não está pronto ou desconectou.');
            return false;
        }

        let numeroLimpo = numero.replace(/\D/g, '');
        
        // Regra para Brasil: Se tem 11 dígitos (DDD + 9 + número), 
        // às vezes o WhatsApp Web espera o formato sem o 9 para IDs antigos 
        // ou com o 9 para novos. O getNumberId costuma resolver isso, mas vamos garantir.
        if (numeroLimpo.length === 11 && numeroLimpo.startsWith('55')) {
             // já está com DDI
        } else if (numeroLimpo.length >= 10 && !numeroLimpo.startsWith('55')) {
            numeroLimpo = `55${numeroLimpo}`;
        }

        console.log(`Verificando número: ${numeroLimpo}`);

        // Tenta obter o ID oficial do WhatsApp
        const numberDetails = await newClient.getNumberId(numeroLimpo);

        let chatId;
        if (numberDetails) {
            chatId = numberDetails._serialized;
        } else {
            // Fallback: Se o getNumberId falhar, tentamos o formato padrão 
            // Isso ajuda a evitar o erro "new chat not found" em alguns casos
            console.warn(`⚠️ getNumberId falhou para ${numeroLimpo}. Tentando formato padrão.`);
            chatId = `${numeroLimpo}@c.us`;
        }

        // Envio da mensagem
        await newClient.sendMessage(chatId, mensagem);

        console.log(`✅ Mensagem enviada com sucesso para ${chatId}`);
        return true;

    } catch (error) {
        // Se o erro for o "findChat", pode ser instabilidade de rede ou do Puppeteer
        if (error.message.includes('findChat')) {
            console.error('❌ Erro de sincronização do WhatsApp (findChat). O número pode ser inválido ou a página oscilou.');
        } else {
            console.error('❌ Erro ao enviar WhatsApp:', error);
        }
        return false;
    }
};