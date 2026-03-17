import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

const isDocker = process.env.NODE_ENV === 'production';
let newClient = null;

// Função utilitária para criar pausas (sleep)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função para gerar um tempo aleatório entre um min e max (para parecer menos robótico)
const randomDelay = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);

// User-Agent real para disfarçar o Puppeteer Headless
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

if (!isDocker) {
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                `--user-agent=${userAgent}` // <-- Adicionado
            ]
        }
    });
    newClient = client;
} else {
    const client = new Client({
        authStrategy: new LocalAuth(),
        dataPath: './.wwebjs_auth',
        puppeteer: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                `--user-agent=${userAgent}` // <-- Adicionado
            ],
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        }
    });
    newClient = client;
}

newClient.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo com o seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

newClient.on('ready', () => {
    console.log('🤖 WhatsApp Bot conectado e pronto para enviar mensagens!');
});

newClient.initialize();

export const enviarMensagemWhatsApp = async (numero, mensagem) => {
    try {
        if (!newClient || !newClient.info || !newClient.info.wid) {
            console.error('❌ O cliente WhatsApp não está pronto ou desconectou.');
            return false;
        }

        let numeroLimpo = numero.replace(/\D/g, '');
        
        if (numeroLimpo.length === 11 && numeroLimpo.startsWith('55')) {
             // já está com DDI
        } else if (numeroLimpo.length >= 10 && !numeroLimpo.startsWith('55')) {
            numeroLimpo = `55${numeroLimpo}`;
        }

        console.log(`Verificando número: ${numeroLimpo}`);

        const numberDetails = await newClient.getNumberId(numeroLimpo);
        let chatId;

        if (numberDetails) {
            chatId = numberDetails._serialized;
        } else {
            console.warn(`⚠️ getNumberId falhou para ${numeroLimpo}. Tentando formato padrão.`);
            chatId = `${numeroLimpo}@c.us`;
        }

        // ==========================================
        // INÍCIO DA HUMANIZAÇÃO DO ENVIO
        // ==========================================

        // 1. Pausa inicial randômica antes de abrir a conversa (1 a 3 segundos)
        await delay(randomDelay(1000, 3000));

        // 2. Obtém a instância do chat para manipular o estado
        const chat = await newClient.getChatById(chatId);

        // 3. Simula que está digitando
        await chat.sendStateTyping();

        // 4. Calcula o tempo de digitação (ex: 50ms por caractere)
        // Garante um mínimo de 1.5s e um máximo de 8s para não travar muito a fila
        let tempoDeDigitacao = mensagem.length * 50; 
        if (tempoDeDigitacao < 1500) tempoDeDigitacao = 1500;
        if (tempoDeDigitacao > 8000) tempoDeDigitacao = randomDelay(6000, 8000);

        console.log(`Simulando digitação por ${tempoDeDigitacao}ms...`);
        await delay(tempoDeDigitacao);

        // ==========================================
        // FIM DA HUMANIZAÇÃO
        // ==========================================

        await newClient.sendMessage(chatId, mensagem);
        
        // Limpa o estado de digitação (por garantia)
        await chat.clearState();

        console.log(`✅ Mensagem enviada com sucesso para ${chatId}`);
        return true;

    } catch (error) {
        if (error.message.includes('findChat')) {
            console.error('❌ Erro de sincronização do WhatsApp (findChat). O número pode ser inválido ou a página oscilou.');
        } else {
            console.error('❌ Erro ao enviar WhatsApp:', error);
        }
        return false;
    }
};