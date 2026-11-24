import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import VersaoTermo from '../models/VersaoTermo.js';
import User from '../models/User.js';
import { enviarMensagemWhatsApp } from '../../services/whatsapp.js';
import AuditService from '../../services/AuditService.js';
import { gerarPdfTermoNavegacao } from '../../utils/gerarTermoPdf.js';
import TermosHistorico from '../models/TermosHistorico.js';
import Mail from '../../services/Mail.js';
import { prepararTokenTermo, montarLinkTermo, buscarPacientePorLinkTermo } from '../../utils/termoLink.js';

// Aceita true/false (boolean) ou "true"/"false" (string). Qualquer outra coisa = inválido.
// Antes, aceite: "false" (string) era tratado como aceite.
function lerAceite(valor) {
    if (valor === true || valor === 'true') return true;
    if (valor === false || valor === 'false') return false;
    return null;
}

// Grava a resposta do termo (paciente pelo link ou operador por telefone).
async function registrarRespostaTermo(paciente, aceite, req) {
    paciente.status_termo = aceite ? 'Aceito' : 'Recusado';

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    if (aceite) {
        // O termo não é salvo como arquivo: é reconstruído ao vivo quando alguém precisa
        // visualizar. Guarda a VERSÃO vigente do texto para manter o que o paciente aceitou.
        const versaoAtiva = await VersaoTermo.findOne({ where: { ativo: true }, order: [['id', 'DESC']] });
        paciente.termo_data_aceite = new Date();
        paciente.termo_ip = ip;
        paciente.termo_user_agent = userAgent;
        paciente.termo_versao_id = versaoAtiva ? versaoAtiva.id : null;
    } else {
        paciente.termo_data_aceite = null;
        paciente.termo_ip = null;
        paciente.termo_user_agent = null;
        paciente.termo_versao_id = null;
    }

    await paciente.save();

    // Registro imutável de quando/como a resposta aconteceu.
    await TermosHistorico.create({
        paciente_id: paciente.id,
        status: paciente.status_termo,
        arquivo_path: null,
        ip,
        user_agent: userAgent
    });

    return { status_termo: paciente.status_termo, termo_data_aceite: paciente.termo_data_aceite };
}

async function enviarPdfTermo(paciente, res) {
    const operadoraNome = paciente.operadoras?.nome || 'sua operadora';
    // Se já aceitou, mostra a versão que ELE viu; senão, a vigente.
    const versao = paciente.versaoTermo || await VersaoTermo.findOne({ where: { ativo: true }, order: [['id', 'DESC']] });
    if (!versao) {
        return res.status(500).json({ error: 'Nenhuma versão do termo está cadastrada no sistema.' });
    }
    // A função gera o PDF e envia direto na resposta
    return gerarPdfTermoNavegacao(paciente, res, operadoraNome, versao);
}


class TermoController {


    async sendLink(req, res) {
        const { paciente_id, telefone_destino, destino_tipo, email_destino } = req.body;

        try {
            const user = await User.findByPk(req.userId);
            const paciente = await Pacientes.findByPk(paciente_id, {
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            if (paciente.tratamento_pausado) {
                return res.status(400).json({ error: 'Este paciente está com o tratamento pausado. Retome o tratamento antes de enviar o termo.' });
            }

            // Link com token aleatório (o id do paciente não abre mais o termo).
            // O token é gravado junto com o status no paciente.save() de cada fluxo abaixo.
            prepararTokenTermo(paciente);
            const linkAcompanhamento = montarLinkTermo(paciente);

            // ==========================================
            // FLUXO DE DISPARO POR E-MAIL
            // ==========================================
            if (destino_tipo === 'email') {
                if (!email_destino) {
                    return res.status(400).json({ error: 'E-mail não informado.' });
                }

                // Atualiza o e-mail no cadastro se for diferente do atual
                if (paciente.email !== email_destino) {
                    paciente.email = email_destino;
                }

                // O status "Pendente" (e o token do link) só é gravado DEPOIS que o e-mail
                // sai — antes, um envio que falhava deixava o paciente contado como enviado.
                const operadoraNome = paciente.operadoras?.nome || 'nossa equipe de saúde';
                
                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h2>Olá, ${paciente.nome}!</h2>
                        <p>Meu nome é ${user.name} e estou entrando em contato em nome da <strong>${operadoraNome}</strong>.</p>
                        <p>Precisamos que você leia e aceite os termos de contato para podermos te acompanhar durante o seu tratamento.</p>
                        <p>Por favor, acesse o link abaixo para visualizar e responder ao termo:</p>
                        <div style="margin: 20px 0;">
                            <a href="${linkAcompanhamento}" style="background-color: #0056b3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Acessar Termo de Acompanhamento
                            </a>
                        </div>
                        <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
                        <p><a href="${linkAcompanhamento}">${linkAcompanhamento}</a></p>
                        <p>Agradecemos a sua atenção!</p>
                    </div>
                `;

                await Mail.sendMail({
                    to: email_destino,
                    subject: 'Termos de Acompanhamento',
                    html: htmlContent
                });

                paciente.status_termo = 'Pendente';
                await paciente.save();

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'Termo E-mail',
                    paciente.id,
                    `Disparou o termo de acompanhamento por e-mail para ${email_destino}.`
                );

                return res.json({ message: 'Link enviado por e-mail com sucesso!' });
            }

            // ==========================================
            // FLUXO: GERAR LINK PRA COPIAR (envio 100% manual, sem
            // disparar nada automaticamente — nem WhatsApp, nem e-mail).
            // Antes esse caso não era tratado aqui e caía, por engano, no
            // bloco de disparo via WhatsApp abaixo — disparando de verdade.
            // ==========================================
            if (destino_tipo === 'copiar_link') {
                paciente.status_termo = 'Pendente';
                await paciente.save();

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'Termo Link Manual',
                    paciente.id,
                    `Gerou o link do termo de acompanhamento para envio manual (nenhum disparo automático foi feito).`
                );

                return res.json({ message: 'Link gerado com sucesso!', link: linkAcompanhamento });
            }

            // ==========================================
            // FLUXO DE DISPARO VIA WHATSAPP (Twilio)
            // ==========================================
            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Nenhum número de destino informado ou cadastrado.' });
            }

            // Validação estrita: DDD e Dígito 9
            let numeroLimpo = String(numeroDestino).replace(/\D/g, '');
            
            if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 13) {
                numeroLimpo = numeroLimpo.substring(2);
            }

            if (numeroLimpo.length !== 11 || numeroLimpo[2] !== '9') {
                return res.status(400).json({ 
                    error: 'Número inválido para envio. O número deve conter o DDD e o dígito 9. Ex: (31) 98888-8888' 
                });
            }

            const enviado = await enviarMensagemWhatsApp(
                numeroDestino,
                paciente.nome,
                paciente.operadoras?.nome || 'sua operadora',
                user.name,
                linkAcompanhamento,
                req.userId
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar mensagem via WhatsApp' });
            }

            // Só depois do envio confirmado (antes ficava "Pendente" mesmo se a Twilio falhasse)
            paciente.status_termo = 'Pendente';
            await paciente.save();

            let nomeDestinoFinal = paciente.nome;
            let papelDestino = 'Paciente';

            if (destino_tipo === 'cuidador') {
                nomeDestinoFinal = paciente.nome_cuidador || 'Não informado';
                papelDestino = 'Cuidador/Responsável';
            } else if (destino_tipo === 'manual') {
                nomeDestinoFinal = 'Número inserido manualmente pelo operador';
                papelDestino = 'Contato Manual/Avulso';
            }

            const mensagemLog = `Disparou o termo de acompanhamento para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId,
                'Envio',
                'Termo WhatsApp',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Link enviado com sucesso!' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

    // Acessado publicamente pelo paciente clicando no link (/paciente/termo/<token>).
    // Só aceita resposta enquanto o termo está Pendente — link de termo cancelado,
    // já respondido ou com id antigo fora da transição não responde nada.
    async answerTerm(req, res) {
        const aceite = lerAceite(req.body?.aceite);
        if (aceite === null) {
            return res.status(400).json({ error: 'Resposta inválida: informe aceite true ou false.' });
        }

        try {
            const paciente = await buscarPacientePorLinkTermo(req.params.id);
            if (!paciente) {
                return res.status(404).json({ error: 'Link inválido ou expirado.' });
            }

            if (paciente.status_termo !== 'Pendente') {
                return res.status(409).json({
                    error: 'Este termo não está mais aguardando resposta.',
                    status_termo: paciente.status_termo,
                    termo_data_aceite: paciente.termo_data_aceite
                });
            }

            const resultado = await registrarRespostaTermo(paciente, aceite, req);
            return res.json({ message: 'Resposta registrada com sucesso', ...resultado });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao processar resposta' });
        }
    }

    // Operador registra a resposta que o paciente deu por telefone (tela Necessidade de
    // Navegação → Termo → "não recebeu o link"). Rota autenticada, por id.
    async registrarRespostaOperador(req, res) {
        const aceite = lerAceite(req.body?.aceite);
        if (aceite === null) {
            return res.status(400).json({ error: 'Resposta inválida: informe aceite true ou false.' });
        }

        try {
            const paciente = await Pacientes.findByPk(req.params.id);
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const resultado = await registrarRespostaTermo(paciente, aceite, req);

            await AuditService.log(
                req.userId, 'Edição', 'Termo', paciente.id,
                `Registrou manualmente que ${paciente.nome} ${paciente.sobrenome || ''} ${aceite ? 'ACEITOU' : 'RECUSOU'} o termo (resposta por telefone).`
            );

            return res.json({ message: 'Resposta registrada com sucesso', ...resultado });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao processar resposta' });
        }
    }

    // Método para o frontend consultar o status em tempo real (Polling)
    async checkStatus(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ status_termo: paciente.status_termo });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    // Usado pela tela pública de aceite, pra saber o status atual e (se já
    // aceito) a data do aceite. Devolve só o necessário para a tela.
    async verifyResponse(req, res) {
        try {
            const paciente = await buscarPacientePorLinkTermo(req.params.id, {
                attributes: ['id', 'status_termo', 'termo_data_aceite'],
                include: [{ model: Operadora, as: 'operadoras', attributes: ['nome'] }]
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Link inválido ou expirado.' });
            }

            return res.json({
                paciente: {
                    status_termo: paciente.status_termo,
                    termo_data_aceite: paciente.termo_data_aceite,
                    operadoras: paciente.operadoras ? { nome: paciente.operadoras.nome } : null
                }
            });
        } catch {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    // 👇 NOVO: cancela/invalida um termo já enviado — antes de responder
    // (ex: enviado pro número errado) ou mesmo depois de já aceito/recusado.
    // Apaga o token do link: o link enviado deixa de abrir até um novo envio.
    async cancelarTermo(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id);
            if (!paciente) return res.status(404).json({ error: 'Paciente não encontrado' });

            const statusAnterior = paciente.status_termo;
            if (statusAnterior === 'Cancelado') {
                return res.status(400).json({ error: 'Este termo já está cancelado.' });
            }

            await paciente.update({
                status_termo: 'Cancelado',
                termo_token: null, // invalida o link enviado
                termo_data_aceite: null,
                termo_ip: null,
                termo_user_agent: null,
                termo_versao_id: null
            });

            await AuditService.log(
                req.userId, 'Edição', 'Termo', paciente.id,
                `Cancelou o termo de ${paciente.nome} ${paciente.sobrenome} (estava "${statusAnterior}") — o link deixa de estar disponível até um novo envio.`
            );

            return res.json({ message: 'Termo cancelado com sucesso.', status_termo: 'Cancelado' });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao cancelar o termo.' });
        }
    }

    // PDF do termo para o PACIENTE (link público com token).
    async previewPdf(req, res) {
        try {
            const paciente = await buscarPacientePorLinkTermo(req.params.id, { include: ['operadoras', 'versaoTermo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Link inválido ou expirado.' });
            }
            return enviarPdfTermo(paciente, res);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao gerar visualização do termo' });
        }
    }

    // PDF do termo para a EQUIPE (tela Termos Assinados) — rota autenticada, por id.
    async pdfAdmin(req, res) {
        try {
            const paciente = await Pacientes.findByPk(req.params.id, { include: ['operadoras', 'versaoTermo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return enviarPdfTermo(paciente, res);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao gerar visualização do termo' });
        }
    }

    // Lista todo paciente com termo aceito — antes essa listagem dependia de
    // um arquivo salvo em PacienteTermoAnexo; agora usa direto o cadastro do
    // paciente (fonte real da verdade) e o PDF é gerado ao vivo quando
    // alguém clicar em "Visualizar/Baixar" (rota /preview-pdf), sem precisar
    // de nenhum arquivo armazenado.
    async listarTermosAceitos(req, res) {
        try {
            const pacientes = await Pacientes.findAll({
                where: { status_termo: 'Aceito' },
                attributes: ['id', 'nome', 'sobrenome', 'cpf', 'termo_data_aceite'],
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: VersaoTermo, as: 'versaoTermo', attributes: ['id', 'titulo'] }
                ],
                order: [['termo_data_aceite', 'DESC']]
            });

            return res.json(pacientes);
        } catch (error) {
            console.error('Erro ao listar termos aceitos:', error);
            return res.status(500).json({ error: 'Erro ao listar termos aceitos.' });
        }
    }

    // Lista o histórico de versões do termo (mais recente primeiro).
    async listarVersoesTermo(req, res) {
        try {
            const versoes = await VersaoTermo.findAll({
                include: [{ model: User, as: 'criador', attributes: ['id', 'name'] }],
                order: [['id', 'DESC']]
            });
            return res.json(versoes);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao listar versões do termo.' });
        }
    }

    // Cria uma nova versão do termo e a torna a ativa — a antiga continua
    // existindo (histórico), só deixa de ser usada em novos aceites.
    // Pacientes que já aceitaram sob a versão anterior continuam vinculados
    // a ela, sem nenhuma alteração retroativa.
    async criarVersaoTermo(req, res) {
        const { titulo, introducao, textoAutorizacao, finalidades, textoCiente, itensCiente } = req.body;

        if (!introducao || !Array.isArray(finalidades) || !Array.isArray(itensCiente)) {
            return res.status(400).json({ error: 'Preencha ao menos a introdução e as duas listas (finalidades e itens de ciência).' });
        }

        try {
            await VersaoTermo.update({ ativo: false }, { where: { ativo: true } });

            const novaVersao = await VersaoTermo.create({
                titulo: titulo || 'TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP',
                conteudo: { introducao, textoAutorizacao, finalidades, textoCiente, itensCiente },
                ativo: true,
                criado_por: req.userId
            });

            await AuditService.log(req.userId, 'Criação', 'Versão do Termo', novaVersao.id, `Nova versão do termo criada e ativada (versão #${novaVersao.id}). Versões anteriores continuam vinculadas aos pacientes que já aceitaram sob elas.`);

            return res.status(201).json(novaVersao);
        } catch (error) {
            console.error('Erro ao criar versão do termo:', error);
            return res.status(500).json({ error: 'Erro ao criar nova versão do termo.' });
        }
    }
}

export default new TermoController();