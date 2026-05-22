import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Gera o PDF do termo.
 * @param {Object} paciente - Objeto com os dados do paciente.
 * @param {Object} [res=null] - Objeto de resposta do Express (para stream direto no navegador).
 * @returns {Promise<string|null>} - Retorna o caminho do arquivo salvo se res não for passado.
 */
export const gerarPdfTermoNavegacao = (paciente, res = null) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            let filePath = null;
            let writeStream = null;

            // Se não passou "res", significa que é para salvar no disco
            if (!res) {
                // Usa o mesmo diretório configurado no seu multer
                const uploadDir = path.resolve('uploads', 'anexos');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }

                const fileName = `termo_${paciente.id}_${uuidv4()}.pdf`;
                filePath = path.join(uploadDir, fileName);
                writeStream = fs.createWriteStream(filePath);
                doc.pipe(writeStream);
            } else {
                // Se passou "res", envia direto para o navegador (preview)
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `inline; filename=termo_paciente_${paciente.id}.pdf`);
                doc.pipe(res);
            }

            // --- CONTEÚDO DO PDF ---
            doc.fontSize(16).font('Helvetica-Bold').text('TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP', { align: 'center' });
            doc.moveDown(2);

            doc.fontSize(12).font('Helvetica').text(`Eu, ${paciente.nome} ${paciente.sobrenome || ''},`);
            doc.text(`CPF nº ${paciente.cpf || 'Não informado'}, declaro estar ciente e de acordo com o acompanhamento realizado pela equipe de navegação da CICFARMA.`);
            doc.moveDown();

            doc.text('Autorizo o contato da equipe por meio do aplicativo WhatsApp, utilizando o número telefônico informado por mim, para fins de:');
            doc.moveDown();
            
            const listItems = [
                'Confirmação de dados e procedimentos;',
                'Envio de orientações assistenciais e administrativas;',
                'Solicitação e recebimento de documentos;',
                'Acompanhamento do tratamento e navegação do paciente;',
                'Informações relacionadas às autorizações junto à operadoras de saúde (Convênio);',
                'Esclarecimento de dúvidas pertinentes ao atendimento.'
            ];
            listItems.forEach(item => {
                doc.text(`• ${item}`, { indent: 20 });
            });
            doc.moveDown();

            doc.text('Declaro estar ciente de que:');
            doc.moveDown();
            const listCiente = [
                'O WhatsApp será utilizado exclusivamente para comunicações relacionadas ao meu atendimento;',
                'As mensagens poderão conter informações pessoais e assistenciais necessárias para continuidade do cuidado;',
                'Posso revogar esta autorização a qualquer momento, mediante solicitação formal à clínica;',
                'A instituição adota medidas de confidencialidade e proteção de dados, em conformidade com a Lei Geral de Proteção de Dados (LGPD – Lei nº 13.709/2018).'
            ];
            listCiente.forEach(item => {
                doc.text(`• ${item}`, { indent: 20 });
            });
            doc.moveDown(2);

            const celular = paciente.celular || paciente.telefone || 'Não informado';
            doc.font('Helvetica-Bold').text('Telefone autorizado para contato via WhatsApp: ', { continued: true }).font('Helvetica').text(celular);
            doc.moveDown(2);

            doc.text('Por ser verdade, firmo o presente termo.');
            doc.moveDown(3);

            // Assinatura e Data
            const dataAtual = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());
            
            doc.text('_________________________________________________', { align: 'center' });
            doc.text('Nome do paciente / responsável legal', { align: 'center' });
            doc.moveDown();
            doc.text(`Local e data: Sabará, ${dataAtual}`, { align: 'center' });

            doc.end();

            // Resolução da Promise
            if (writeStream) {
                writeStream.on('finish', () => resolve(filePath));
                writeStream.on('error', (err) => reject(err));
            } else {
                // Se for stream para 'res', resolve imediatamente após o end()
                resolve(null); 
            }

        } catch (error) {
            reject(error);
        }
    });
};