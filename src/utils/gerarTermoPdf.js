import PDFDocument from 'pdfkit';

/**
 * Gera o PDF do termo e transmite direto na resposta HTTP — nunca salva
 * arquivo em disco. O texto vem da "versão" passada (tabela versoes_termo),
 * não é mais fixo no código — isso permite reconstruir fielmente o termo
 * que um paciente específico aceitou, mesmo que o texto padrão tenha
 * mudado depois pra novos pacientes.
 *
 * @param {Object} paciente - Objeto com os dados do paciente.
 * @param {Object} res - Objeto de resposta do Express (obrigatório — o PDF é sempre transmitido direto, nunca salvo em disco).
 * @param {string} operadoraNome - Nome da operadora do paciente.
 * @param {Object} versao - Registro de versoes_termo: { titulo, conteudo: { introducao, textoAutorizacao, finalidades[], textoCiente, itensCiente[] } }
 */
export const gerarPdfTermoNavegacao = (paciente, res, operadoraNome, versao) => {
    return new Promise((resolve, reject) => {
        try {
            const conteudo = versao?.conteudo || {};
            const doc = new PDFDocument({ margin: 50 });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename=termo_paciente_${paciente.id}.pdf`);
            doc.pipe(res);

            // --- CONTEÚDO DO PDF ---
            doc.fontSize(16).font('Helvetica-Bold').text(
                versao?.titulo || 'TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP',
                { align: 'center' }
            );
            doc.moveDown(2);

            doc.fontSize(12).font('Helvetica').text(`Eu, ${paciente.nome} ${paciente.sobrenome || ''},`);
            doc.text(`CPF nº ${paciente.cpf || 'Não informado'}, ${(conteudo.introducao || '').replace('{OPERADORA}', operadoraNome)}`);
            doc.moveDown();

            doc.text(conteudo.textoAutorizacao || '');
            doc.moveDown();

            (conteudo.finalidades || []).forEach(item => {
                doc.text(`• ${item}`, { indent: 20 });
            });
            doc.moveDown();

            doc.text(conteudo.textoCiente || '');
            doc.moveDown();
            (conteudo.itensCiente || []).forEach(item => {
                doc.text(`• ${item}`, { indent: 20 });
            });
            doc.moveDown(2);

            const celular = paciente.celular || paciente.telefone || 'Não informado';
            doc.font('Helvetica-Bold').text('Telefone autorizado para contato via WhatsApp: ', { continued: true }).font('Helvetica').text(celular);
            doc.moveDown(2);

            doc.end();
            resolve(null);

        } catch (error) {
            reject(error);
        }
    });
};
