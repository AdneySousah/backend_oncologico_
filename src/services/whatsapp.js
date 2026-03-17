import pkg from 'whatsapp-web.js';
const { Client, LocalAuth,Poll } = pkg;
import qrcode from 'qrcode-terminal';
import axios from 'axios';

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


// 1. Função para enviar o NPS
export const enviarEnqueteNPS = async (numero, nomePaciente) => {
    try {
        if (!newClient || !newClient.info) return false;

        let numeroLimpo = numero.replace(/\D/g, '');
        if (numeroLimpo.length >= 10 && !numeroLimpo.startsWith('55')) {
            numeroLimpo = `55${numeroLimpo}`;
        }

        // Correção 1: Valida o número com a Meta para pegar o ID exato (evita o erro No LID)
        console.log(`Verificando número para NPS: ${numeroLimpo}`);
        const numberDetails = await newClient.getNumberId(numeroLimpo);
        let chatId;

        if (numberDetails) {
            chatId = numberDetails._serialized;
        } else {
            console.warn(`⚠️ getNumberId falhou para ${numeroLimpo}. Tentando formato padrão.`);
            chatId = `${numeroLimpo}@c.us`;
        }

        const texto = `Olá ${nomePaciente}, somos da CIC Oncologia. Gostaríamos de saber: De 0 a 10, o quanto você recomendaria nosso atendimento?`;
        
        const npsPoll = new Poll(texto, [
            '10 - Com certeza', '9', '8', '7', '6', '5', '4', '3', '2', '1', '0 - Nunca'
        ], { multiples: false });

        // Correção 2: Isola a simulação de digitação. Se o chat não existir, ele não trava a API.
        try {
            const chat = await newClient.getChatById(chatId);
            await chat.sendStateTyping();
            await delay(2000); 
            await chat.clearState();
        } catch (humanizeError) {
            console.warn('⚠️ Não foi possível simular digitação (chat não iniciado), prosseguindo com o envio direto...');
            await delay(1000); // Pausa leve só para não ser robótico demais
        }

        // Envia a mensagem de fato
        await newClient.sendMessage(chatId, npsPoll);
        console.log(`✅ Enquete NPS enviada com sucesso para ${chatId}`);

        return true;
    } catch (error) {
        console.error('❌ Erro crítico ao enviar NPS WhatsApp:', error);
        return false;
    }
};

// 2. Ouvinte de eventos: Captura a nota quando a pessoa clica no botão do WhatsApp

newClient.on('vote_update', async (vote) => {
    try {
        if (vote.selectedOptions && vote.selectedOptions.length > 0) {
            
            const idVotante = vote.voter || vote.voterJid; 
            
            if (!idVotante) {
                console.error("⚠️ Identificador do votante não encontrado.");
                return;
            }

            // ==========================================
            // CORREÇÃO DO @LID: TRADUZ PARA NÚMERO REAL
            // ==========================================
            let numeroQueVotou = idVotante.split('@')[0]; // Fallback inicial
            
            try {
                // Pede pro WhatsApp buscar quem é esse LID
                const contatoOriginal = await newClient.getContactById(idVotante);
                if (contatoOriginal && contatoOriginal.number) {
                    numeroQueVotou = contatoOriginal.number; // Aqui vem o "553199999999" real!
                }
            } catch (erroContato) {
                console.warn("⚠️ Aviso: Não foi possível resolver o contato original do LID.");
            }
            // ==========================================

            const opcaoSelecionada = vote.selectedOptions[0];
            const textoDaOpcao = opcaoSelecionada.name || opcaoSelecionada.localName || '';
            
            if (!textoDaOpcao) return;

            const notaString = textoDaOpcao.split(' ')[0]; 
            const notaNumero = parseInt(notaString);

            // POST para o backend
            const apiUrl = process.env.API_URL || 'http://127.0.0.1:3002'; // Mantive a sua porta 3002 que vi no log
            
            await axios.post(`${apiUrl}/nps/resposta`, {
                celular: numeroQueVotou,
                nota: notaNumero
            });

            console.log(`✅ NPS salvo com sucesso: Número ${numeroQueVotou} votou ${notaNumero}`);
        }
    } catch (error) {
        console.error('❌ Erro ao processar voto do NPS:', error);
    }
});