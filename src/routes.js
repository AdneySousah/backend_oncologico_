import { Router } from "express";

import multer from 'multer';
import multerConfig from './config/multer.cjs';

import authMiddleware from "./middlewares/auth.js";
import limiteTentativas from "./middlewares/limiteTentativas.js";
import validarAssinaturaTwilio from "./middlewares/twilioSignature.js";
import checkPermission from "./middlewares/checkPermission.js";
import { exigirPacienteDaOperadora, exigirMonitoramentoDaOperadora, exigirIdNumerico } from "./utils/permissionUtils.js";

import UserController from "./app/controllers/UserController.js";
import SessionController from "./app/controllers/SessionController.js";
import OperadoraController from "./app/controllers/OperadoraController.js";
import PacientesController from "./app/controllers/PacientesController.js";
import EvaluationBuilderController from "./app/controllers/EvaluationBuilderController.js";
import EvaluationResponseController from './app/controllers/EvaluationResponseController.js';
import TermoController from './app/controllers/TermoController.js';
import PerfilController from "./app/controllers/PerfilController.js";
import MonitoramentoMedicamentoController from "./app/controllers/MonitoramentoMedicamentoController.js";
import ReacaoAdversaController from "./app/controllers/ReacaoAdversaController.js";
import DashboardController from "./app/controllers/DashboardController.js";
import PasswordResetController from "./app/controllers/PasswordResetController.js";
import AuditLogController from "./app/controllers/AuditLogController.js";

import NpsController from "./app/controllers/NpsController.js";
import NpsHealthController from "./app/controllers/NpsHealthController.js";
import ChatController from "./app/controllers/ChatController.js";
import FaturamentoController from "./app/controllers/FaturamentoController.js";
import MotivoFalhaContatoController from "./app/controllers/MotivoFalhaContatoController.js";
import MotivoPausaTratamentoController from "./app/controllers/MotivoPausaTratamentoController.js";
import AssistenteCalculoController from "./app/controllers/AssistenteCalculoController.js";

import ReservaEdicaoController from "./app/controllers/ReservaEdicaoController.js";


const router = Router();

const upload = multer(multerConfig);


// Limite de tentativas por usuário/e-mail (força bruta de senha e de código)
router.post('/session', limiteTentativas({ maximo: 10, janelaMinutos: 15, mensagem: 'Muitas tentativas de login. Aguarde alguns minutos e tente de novo.' }), SessionController.store)

router.get('/nps/paciente/:paciente_id/atendimento/:monitoramento_id', NpsController.verifyNpsPatient);
router.post('/nps/paciente/:paciente_id/atendimento/:monitoramento_id/responder', NpsController.answerNps);



/* rota publica chat ativo */
router.post('/webhooks/twilio/whatsapp', validarAssinaturaTwilio, ChatController.receiveWebhook);
// Rotas públicas do termo: :id é o TOKEN do link (ver utils/termoLink.js), não o id do paciente
router.post('/termos/paciente/:id', TermoController.answerTerm);

router.get('/pacientes/:id', TermoController.verifyResponse);
router.get('/termos/paciente/:id/preview-pdf', TermoController.previewPdf);




router.post('/forgot-password', limiteTentativas({ maximo: 5, janelaMinutos: 60 }), PasswordResetController.forgotPassword);
router.post('/verify-code', limiteTentativas({ maximo: 5, janelaMinutos: 15 }), PasswordResetController.verifyCode);
router.post('/reset-password', limiteTentativas({ maximo: 5, janelaMinutos: 15 }), PasswordResetController.resetPassword);


// ==========================================
// 1ª CAMADA DE SEGURANÇA: EXIGE LOGIN VÁLIDO
// ==========================================
router.use(authMiddleware)

// Criação de usuário exige login e permissão (antes ficava pública, antes do authMiddleware).
router.post('/users', checkPermission('usuarios', 'editar'), UserController.store);



// --- ROTAS DE USUÁRIOS E PERFIS ---
router.put('/users/first-access', UserController.changeFirstPassword)
router.get('/users/me', UserController.profile);
router.get('/users', checkPermission('usuarios', 'acessar'), UserController.index);
router.put('/users/:id', checkPermission('usuarios', 'editar'), UserController.update);
router.delete('/users/:id', checkPermission('usuarios', 'excluir'), UserController.delete);


// Vinculei os perfis à permissão de 'usuarios' pois fazem parte do mesmo contexto administrativo
router.post('/perfis', checkPermission('usuarios', 'editar'), PerfilController.store);
router.get('/perfis', checkPermission('usuarios', 'acessar'), PerfilController.index);
router.get('/perfis/:id', checkPermission('usuarios', 'acessar'), exigirIdNumerico(), PerfilController.show);
router.put('/perfis/:id', checkPermission('usuarios', 'editar'), exigirIdNumerico(), PerfilController.update);


// --- ROTAS DE OPERADORAS ---
router.post('/operadoras', checkPermission('operadoras', 'editar'), OperadoraController.store);
router.get('/operadoras', checkPermission('operadoras', 'acessar'), OperadoraController.index);
router.put('/operadoras/:id', checkPermission('operadoras', 'editar'), OperadoraController.update);
router.patch('/operadoras/:id/status', checkPermission('operadoras', 'editar'), OperadoraController.toggleActive);


// --- ROTAS DOS PACIENTES ---
// Cadastro/edição manual de paciente não existe mais: pacientes vêm só via sincronização
// externa (rotas abaixo). Mantidos apenas os endpoints que a "Necessidade de Navegação"
// e a "Nova Avaliação" realmente consomem.
router.post('/pacientes/sync', checkPermission('pacientes', 'editar'), PacientesController.syncExternal);
router.get('/pacientes/detalhes/:id', checkPermission('pacientes', 'acessar'), exigirPacienteDaOperadora('id'), PacientesController.show);
router.get('/pacientes/:id/medicamentos-ativos', checkPermission('pacientes', 'acessar'), exigirPacienteDaOperadora('id'), PacientesController.medicamentosAtivos);
router.post('/pacientes/:id/sync-individual', checkPermission('pacientes', 'editar'), exigirPacienteDaOperadora('id'), PacientesController.syncIndividual);
router.get('/sync/pacientes/check', checkPermission('pacientes', 'acessar'), PacientesController.checkSync);
router.patch('/pacientes/:id/pausar-tratamento', checkPermission('pacientes', 'editar'), exigirPacienteDaOperadora('id'), PacientesController.pausarTratamento);
router.patch('/pacientes/:id/retomar-tratamento', checkPermission('pacientes', 'editar'), exigirPacienteDaOperadora('id'), PacientesController.retomarTratamento);


// --- ROTAS DE AVALIAÇÕES (QUESTIONÁRIOS) ---
router.post('/evaluations/templates', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.store);
router.patch('/evaluations/templates/:id/status', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.toggleStatus);
router.get('/evaluations/templates', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.index);

// Rota de buscar os pendentes do paciente
router.get('/evaluations/templates/pending/:paciente_id', checkPermission('avaliacoes', 'acessar'), exigirPacienteDaOperadora('paciente_id'), EvaluationBuilderController.getPendingForPatient);

// NOVA ROTA AQUI: Buscar um template específico pelo ID (deve ficar abaixo da rota de pending!)
router.get('/evaluations/templates/:id', checkPermission('avaliacoes', 'acessar'), exigirIdNumerico(), EvaluationBuilderController.show);

router.put('/evaluations/templates/:id', checkPermission('avaliacoes', 'editar'), exigirIdNumerico(), EvaluationBuilderController.update);

// Rotas de respostas e histórico
router.post('/evaluations/responses', checkPermission('avaliacoes', 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), EvaluationResponseController.store);
router.get('/evaluations/responses', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);
router.get('/evaluations/paciente/:paciente_id/history', checkPermission('avaliacoes', 'acessar'), exigirPacienteDaOperadora('paciente_id'), EvaluationResponseController.history);
router.get('/evaluations/pendentes-alerta', checkPermission(['avaliacoes', 'telemonitoramento', 'pacientes'], 'acessar'), EvaluationResponseController.pendentesAlerta);

// --- TIMELINE DE AVALIAÇÕES ---
router.get('/avaliacoes', checkPermission(['linhadotempo', 'avaliacoes'], 'acessar'), EvaluationResponseController.index);


// --- ROTAS DE TERMOS ---
router.post('/termos/send', checkPermission('termos', 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), TermoController.sendLink);
router.get('/termos/paciente/:id/status', checkPermission('termos', 'acessar'), exigirPacienteDaOperadora('id'), TermoController.checkStatus);
router.patch('/termos/paciente/:id/cancelar', checkPermission('termos', 'editar'), exigirPacienteDaOperadora('id'), TermoController.cancelarTermo);
// Resposta do termo registrada pelo operador (paciente respondeu por telefone)
router.post('/termos/paciente/:id/resposta-operador', checkPermission('termos', 'editar'), exigirPacienteDaOperadora('id'), TermoController.registrarRespostaOperador);
// PDF do termo para a equipe (tela Termos Assinados) — a rota pública agora só aceita o token do link
router.get('/termos/paciente/:id/pdf', checkPermission('termo', 'acessar'), exigirPacienteDaOperadora('id'), TermoController.pdfAdmin);

router.post('/nps/send', checkPermission('avaliacoes', 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), NpsController.sendNps);
// Nota de NPS informada pelo atendente (antes ficava pública, antes do authMiddleware)
router.post('/nps/manual', checkPermission(['avaliacoes', 'telemonitoramento'], 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), NpsController.manualSubmit); 
router.get('/nps', checkPermission('dashboard', 'acessar'), NpsController.index); 
router.get('/nps/paciente/:id/atendimento/:monitoramento_id/status', checkPermission(['telemonitoramento', 'avaliacoes'], 'acessar'), exigirPacienteDaOperadora('id'), NpsController.checkPatientStatus);



// Rotas de monitoramento

router.post('/monitoramento-medicamentos', checkPermission('telemonitoramento', 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), MonitoramentoMedicamentoController.store);
router.get('/monitoramento-medicamentos/pendentes', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.index);
router.get('/monitoramento-medicamentos/candidatos-retomada', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.candidatosRetomada);
// 👇 LINHA DE TRATAMENTO: medicamentos novos recebidos de um paciente em acompanhamento (oferecidos logo após o contato)
router.get('/monitoramento-medicamentos/paciente/:pacienteId/novas-linhas', checkPermission('telemonitoramento', 'acessar'), exigirPacienteDaOperadora('pacienteId'), MonitoramentoMedicamentoController.novasLinhasPendentes);
router.get('/monitoramento/timeline', checkPermission(['linhadotempo', 'telemonitoramento'], 'acessar'), MonitoramentoMedicamentoController.timeline);

router.put('/monitoramento-medicamentos/vincular-avaliacao', checkPermission('avaliacoes', 'editar'), exigirPacienteDaOperadora('paciente_id', 'body'), MonitoramentoMedicamentoController.vincularAvaliacaoSilencioso);


// Rotas de sincronização em tempo real do evento atual
router.get('/monitoramento-medicamentos/:id/historico-aberturas', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.historicoAberturas);
router.get('/monitoramento-medicamentos/:id/historico-compras', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.historicoCompras);
router.get('/monitoramento-medicamentos/:id/verificar-sincronizacao-atual', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.verificarSincronizacaoAtual);
router.put('/monitoramento-medicamentos/:id/confirmar-sincronizacao-atual', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.confirmarSincronizacaoAtual);
router.get('/monitoramento-medicamentos/:id/verificar-compra', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.verificarNovaCompra);
router.put('/monitoramento-medicamentos/:id/data-administracao', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.informarDataAdministracao);
router.put('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.update);
router.put('/monitoramento-medicamentos/:id/reembolso', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.criarEventoReembolso);
router.put('/monitoramento-medicamentos/conjunto/registrar', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora((req) => (req.body?.registros || []).map(r => r.monitoramento_id)), MonitoramentoMedicamentoController.registrarContatoConjunto);
router.put('/monitoramento-medicamentos/:id/data-proximo-contato', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.atualizarDataProximoContato);
router.get('/monitoramento-medicamentos/recalculaveis', checkPermission('recalculo', 'acessar'), MonitoramentoMedicamentoController.listarRecalculaveis);
router.put('/monitoramento-medicamentos/:id/recalcular', checkPermission('recalculo', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.recalcular);
router.get('/monitoramento-medicamentos/pausados', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.listarPausados);
router.patch('/monitoramento-medicamentos/:id/pausar', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.pausarMedicamento);
router.patch('/monitoramento-medicamentos/:id/destravar-pausa', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.destravarPausaMedicamento);
router.patch('/monitoramento-medicamentos/:id/estender-pausa', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.estenderPausaMedicamento);
// ACUMULAR SOBRAS: marcar/desmarcar (com histórico) e consultar o histórico do medicamento
router.patch('/monitoramento-medicamentos/:id/acumular-sobras', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.definirAcumuloSobras);
router.get('/monitoramento-medicamentos/:id/acumular-sobras/historico', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.historicoAcumuloSobras);
// Cálculo puro (sem dado sensível), usado pela tela de confirmação de
// posologia em vários lugares — só exige estar logado, sem permissão
// de módulo específica.
router.post('/monitoramento-medicamentos/preview-posologia', checkPermission(['telemonitoramento', 'avaliacoes', 'recalculo'], 'acessar'), MonitoramentoMedicamentoController.previewPosologia);
// 👇 NOVO: "com essa pausa/descontinuação o paciente deve ter X comprimidos" —
// projeção na data em que parou de tomar, pra confirmar com o paciente.
router.post('/monitoramento-medicamentos/:id/projecao-restante', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.projecaoRestante);

// Buscar detalhes de um monitoramento específico (necessário para carregar o modal de edição)
router.get('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'acessar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.show);

// Edição retroativa de um contato já concluído
router.put('/monitoramento-medicamentos/:id/edicao-retroativa', checkPermission('telemonitoramento', 'editar'), exigirMonitoramentoDaOperadora(), MonitoramentoMedicamentoController.updateRetroativo);

/* Rotas de ficha ram */
router.post('/reacao-adversa', checkPermission('reacao_adversa', 'editar'), ReacaoAdversaController.store);
router.get('/reacao-adversa', checkPermission('reacao_adversa', 'acessar'), ReacaoAdversaController.index);
router.put('/reacao-adversa/:id', checkPermission('reacao_adversa', 'editar'), ReacaoAdversaController.update);
router.delete('/reacao-adversa/:id', checkPermission('reacao_adversa', 'excluir'), ReacaoAdversaController.delete);
router.post('/reacao-adversa/validate', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.validateExcel);
router.post('/reacao-adversa/import', checkPermission('reacao_adversa', 'editar'), upload.single('file'), ReacaoAdversaController.importExcel);


router.get('/dashboard', checkPermission('dashboard', 'acessar'), DashboardController.index);
router.post('/dashboard/fechar-mes', checkPermission('dashboard', 'editar'), DashboardController.fecharMes);
router.get('/dashboard/status-fechamento-mes-anterior', checkPermission('fechar_mes_dashboard', 'acessar'), DashboardController.statusFechamentoMesAnterior);
router.post('/dashboard/fechar-mes-anterior', checkPermission('fechar_mes_dashboard', 'editar'), DashboardController.fecharMesAnterior);


router.get('/audit-logs',checkPermission('audit-logs', 'acessar'), AuditLogController.index);

router.get('/nps/health',checkPermission('check-saude', 'acessar'), NpsHealthController.checkStatus);



router.get('/chat/conversations', checkPermission('chat', 'acessar'), ChatController.listConversations);
router.get('/chat/conversations/:id', checkPermission('chat', 'acessar'), exigirIdNumerico(), ChatController.getHistory);
router.post('/chat/send', checkPermission('chat', 'editar'), ChatController.sendMessage);
router.post('/chat/reopen', checkPermission('chat', 'editar'), ChatController.reopenWindow);
router.get('/chat/unread', checkPermission('chat', 'acessar'), ChatController.getUnreadCounts);
router.delete('/chat/conversations/:id', checkPermission('chat', 'excluir'), exigirIdNumerico(), ChatController.deleteConversation);


router.get('/faturamento', checkPermission('faturamento', 'acessar'), FaturamentoController.index);


router.get('/termos-anexos/todos', checkPermission('termo', 'acessar'), TermoController.listarTermosAceitos);
router.get('/termos/versoes', checkPermission('termo', 'acessar'), TermoController.listarVersoesTermo);
router.post('/termos/versoes', checkPermission('termo', 'editar'), TermoController.criarVersaoTermo);



// ==========================================
// ROTAS: Motivos de Falha de Contato
// ==========================================
router.get('/motivos-falha-contato', MotivoFalhaContatoController.index);
// a leitura fica livre para quem está logado: o Telemonitoramento usa a lista
router.post('/motivos-falha-contato', checkPermission('falhascontatos', 'editar'), MotivoFalhaContatoController.store);
router.put('/motivos-falha-contato/:id', checkPermission('falhascontatos', 'editar'), MotivoFalhaContatoController.update);
router.delete('/motivos-falha-contato/:id', checkPermission('falhascontatos', 'excluir'), MotivoFalhaContatoController.delete);

// ==========================================
// ROTAS: Motivos de Pausa/Descontinuação de Tratamento
// (compartilhado entre Necessidade de Navegação e Telemonitoramento)
// ==========================================
router.get('/motivos-pausa-tratamento', MotivoPausaTratamentoController.index);
// a leitura fica livre para quem está logado: as telas de pausa usam a lista
router.post('/motivos-pausa-tratamento', checkPermission('pausa_tratamento', 'editar'), MotivoPausaTratamentoController.store);
router.put('/motivos-pausa-tratamento/:id', checkPermission('pausa_tratamento', 'editar'), MotivoPausaTratamentoController.update);
router.delete('/motivos-pausa-tratamento/:id', checkPermission('pausa_tratamento', 'excluir'), MotivoPausaTratamentoController.delete);



// ==========================================
// ROTAS: Reserva de Edição de Monitoramento de Medicamentos
// ==========================================
router.post('/monitoramento-medicamentos/paciente/:pacienteId/reserva-edicao', checkPermission('telemonitoramento', 'editar'), exigirPacienteDaOperadora('pacienteId'), ReservaEdicaoController.reservar);
router.delete('/monitoramento-medicamentos/paciente/:pacienteId/reserva-edicao', checkPermission('telemonitoramento', 'editar'), exigirPacienteDaOperadora('pacienteId'), ReservaEdicaoController.liberar);

// ==========================================
// ROTAS: Assistente de Cálculo
// ==========================================

router.post('/assistente-calculo', checkPermission('telemonitoramento', 'acessar'), AssistenteCalculoController.calcular);




export default router;
