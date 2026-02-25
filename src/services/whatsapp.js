import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

// 1. Instanciamos o client no escopo global do arquivo
/* const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { 
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    }
}); */

const client = new Client({
    authStrategy: new LocalAuth(),
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
        ] 
    }
});

// 2. Configuramos os eventos
client.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo com o seu WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('🤖 WhatsApp Bot conectado e pronto para enviar mensagens!');
});

// 3. Inicializamos o client
client.initialize();

// 4. Exportamos a função que vai USAR o client instanciado lá em cima
export const enviarMensagemWhatsApp = async (numero, mensagem) => {
    try {
        const numeroLimpo = numero.replace(/\D/g, '');
        const numeroComDDI = `55${numeroLimpo}`; 
        
        // O PULO DO GATO: Agora o 'client' existe e vai resolver o número
        const numberDetails = await client.getNumberId(numeroComDDI);

        if (!numberDetails) {
            console.error(`❌ O número ${numeroComDDI} não possui WhatsApp registrado.`);
            return false;
        }

        await client.sendMessage(numberDetails._serialized, mensagem);
        
        console.log(`✅ Mensagem enviada com sucesso para ${numeroComDDI}`);
        return true;
        
    } catch (error) {
        console.error('❌ Erro ao enviar WhatsApp:', error);
        return false;
    }
};