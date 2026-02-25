import { Router } from "express";

import multer from 'multer';
import multerConfig from './config/multer.cjs';
import multerConfigAnexos from './config/anexosMulter.cjs';
import multerConfigEntrevistaAnexos from './config/anexosEntrevistaMulter.cjs';

import authMiddleware from "./middlewares/auth.js";
import checkPermission from "./middlewares/checkPermission.js"; // Importe o novo middleware

import UserController from "./app/controllers/UserController.js";
import OncologyProfessionalController from "./app/controllers/OncologyProfessionalController.js";
import EspecialitesController from "./app/controllers/EspecialitesController.js";
import SessionController from "./app/controllers/SessionController.js";
import OperadoraController from "./app/controllers/OperadoraController.js";
import PacientesController from "./app/controllers/PacientesController.js";
import PrestadorMedicoController from "./app/controllers/PrestadorMedicoController.js";
import DiagnosticoController from "./app/controllers/DiagnosticoController.js";
import ExamesController from "./app/controllers/ExamesController.js";
import InfosComorbidadeController from "./app/controllers/InfosComorbidadeController.js";
import EntrevistaMedicaController from "./app/controllers/EntrevistaMedicaController.js";
import EvaluationBuilderController from "./app/controllers/EvaluationBuilderController.js";
import EvaluationResponseController from './app/controllers/EvaluationResponseController.js';
import MedicoController from "./app/controllers/MedicoController.js";
import ComorbidadesController from "./app/controllers/ComorbidadesController.js";
import MedicamentosController from "./app/controllers/MedicamentosController.js";
import TermoController from './app/controllers/TermoController.js';
import PerfilController from "./app/controllers/PerfilController.js";
import MonitoramentoMedicamentoController from "./app/controllers/MonitoramentoMedicamentoController.js";
import ReacaoAdversaController from "./app/controllers/ReacaoAdversaController.js";
import DashboardController from "./app/controllers/DashboardController.js";



const router = Router();

const upload = multer(multerConfig);
const uploadAnexos = multer(multerConfigAnexos);
const uploadEntrevistaAnexos = multer(multerConfigEntrevistaAnexos);


router.post('/session', SessionController.store)
// Rota Pública (O paciente clica no link do zap e essa rota não pode ter authMiddleware)
router.post('/termos/paciente/:id', TermoController.answerTerm);
router.get('/pacientes/:id', TermoController.verifyResponse);

// ==========================================
// 1ª CAMADA DE SEGURANÇA: EXIGE LOGIN VÁLIDO
// ==========================================

router.use(authMiddleware)


// --- ROTAS DE USUÁRIOS E PERFIS ---
router.put('/users/first-access', UserController.changeFirstPassword)
router.post('/users', checkPermission('usuarios', 'editar'), UserController.store);
router.get('/users', checkPermission('usuarios', 'acessar'), UserController.index);
router.put('/users/:id', checkPermission('usuarios', 'editar'), UserController.update);
router.delete('/users/:id', checkPermission('usuarios', 'excluir'), UserController.delete);


// Vinculei os perfis à permissão de 'usuarios' pois fazem parte do mesmo contexto administrativo
router.post('/perfis', checkPermission('usuarios', 'editar'), PerfilController.store);
router.get('/perfis', checkPermission('usuarios', 'acessar'), PerfilController.index);
router.get('/perfis/:id', checkPermission('usuarios', 'acessar'), PerfilController.show);
router.put('/perfis/:id', checkPermission('usuarios', 'editar'), PerfilController.update);


// --- ROTAS DE PROFISSIONAIS ---
router.post('/professionals', checkPermission('profissionais', 'editar'), OncologyProfessionalController.store);
router.get('/professionals', checkPermission('profissionais', 'acessar'), OncologyProfessionalController.index);


// --- ROTAS DE ESPECIALIDADES ---
router.post('/specialities', checkPermission('especialidades', 'editar'), EspecialitesController.store);
router.get('/specialities', checkPermission('especialidades', 'acessar'), EspecialitesController.index);


// --- ROTAS DE OPERADORAS ---
router.post('/operadoras', checkPermission('operadoras', 'editar'), OperadoraController.store);
router.get('/operadoras', checkPermission('operadoras', 'acessar'), OperadoraController.index);
router.put('/operadoras/:id', checkPermission('operadoras', 'editar'), OperadoraController.update);


// --- ROTAS DOS PACIENTES ---
router.post('/pacientes', checkPermission('pacientes', 'editar'), uploadAnexos.array('anexos_files'), PacientesController.store);
router.get('/pacientes', checkPermission('pacientes', 'acessar'), PacientesController.index);
router.put('/pacientes/:id', checkPermission('pacientes', 'editar'), uploadAnexos.array('anexos_files'), PacientesController.update);
router.post('/pacientes/validate', checkPermission('pacientes', 'editar'), upload.single('file'), PacientesController.validateImport);
router.post('/pacientes/import', checkPermission('pacientes', 'editar'), upload.single('file'), PacientesController.importExcel);
router.get('/anexos/nomes', checkPermission('pacientes', 'acessar'), PacientesController.getNomesAnexos);
router.get('/pacientes/operadoras-filtro', PacientesController.getOperadorasFiltro);
router.patch('/pacientes/:id/status', checkPermission('pacientes', 'editar'), PacientesController.toggleActive);


// --- ROTAS DE PRESTADORES MÉDICOS (HOSPITAIS) ---
router.post('/prestadores-medicos', checkPermission('prestadores_medicos', 'editar'), PrestadorMedicoController.store);
router.get('/prestadores-medicos', checkPermission('prestadores_medicos', 'acessar'), PrestadorMedicoController.index);
router.put('/prestadores-medicos/:id', checkPermission('prestadores_medicos', 'editar'), PrestadorMedicoController.update);


// --- ROTAS DE DIAGNÓSTICOS CID ---
router.post('/diagnosticos', checkPermission('diagnosticos', 'editar'), DiagnosticoController.store);
router.get('/diagnosticos', checkPermission('diagnosticos', 'acessar'), DiagnosticoController.index);
router.put('/diagnosticos/:id', checkPermission('diagnosticos', 'editar'), DiagnosticoController.update);


// --- ROTAS DE EXAMES ---
router.post('/exames', checkPermission('exames', 'editar'), ExamesController.store);


// --- ROTAS DE INFOS COMORBIDADE ---
router.post('/infos-comorbidade', checkPermission('comorbidades', 'editar'), InfosComorbidadeController.store);


// --- ROTAS DE ENTREVISTA MÉDICA ---
router.post('/entrevistas-medicas', checkPermission('entrevistas_medicas', 'editar'), uploadEntrevistaAnexos.array('anexos_files'), EntrevistaMedicaController.store);
router.get('/entrevistas-medicas', checkPermission('entrevistas_medicas', 'acessar'), EntrevistaMedicaController.index);
router.get('/entrevistas-medicas/:id', checkPermission('entrevistas_medicas', 'acessar'), EntrevistaMedicaController.show);


// --- ROTAS DE AVALIAÇÕES (QUESTIONÁRIOS) ---
router.post('/evaluations/templates', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.store);
router.patch('/evaluations/templates/:id/status', checkPermission('avaliacoes', 'editar'), EvaluationBuilderController.toggleStatus);
router.get('/evaluations/templates', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.index);
router.post('/evaluations/responses', checkPermission('avaliacoes', 'editar'), EvaluationResponseController.store);
router.get('/evaluations/responses', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);
router.get('/evaluations/templates/pending/:entrevista_id', checkPermission('avaliacoes', 'acessar'), EvaluationBuilderController.getPendingForInterview);

// --- TIMELINE DE AVALIAÇÕES ---
router.get('/avaliacoes', checkPermission('avaliacoes', 'acessar'), EvaluationResponseController.index);


// --- ROTAS DE MÉDICOS ---
router.post('/medicos', checkPermission('medicos', 'editar'), MedicoController.store);
router.get('/medicos', checkPermission('medicos', 'acessar'), MedicoController.index);


// --- ROTAS DE COMORBIDADES (CADASTRO BASE) ---
router.post('/comorbidades', checkPermission('comorbidades', 'editar'), ComorbidadesController.store);
router.get('/comorbidades', checkPermission('comorbidades', 'acessar'), ComorbidadesController.index);


// --- ROTAS DE MEDICAMENTOS ---
router.post('/medicamentos', checkPermission('medicamentos', 'editar'), MedicamentosController.store);
router.get('/medicamentos', checkPermission('medicamentos', 'acessar'), MedicamentosController.index);


// --- ROTAS DE TERMOS ---
router.post('/termos/send', checkPermission('termos', 'editar'), TermoController.sendLink);
router.get('/termos/paciente/:id/status', checkPermission('termos', 'acessar'), TermoController.checkStatus);



// Rotas de monitoramento
router.post('/monitoramento-medicamentos', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.store);
router.put('/monitoramento-medicamentos/:id', checkPermission('telemonitoramento', 'editar'), MonitoramentoMedicamentoController.update);
router.get('/monitoramento-medicamentos/pendentes', checkPermission('telemonitoramento', 'acessar'), MonitoramentoMedicamentoController.index);
router.get('/monitoramento/timeline', MonitoramentoMedicamentoController.timeline)

/* Rotas de ficha ram */
router.post('/reacao-adversa', checkPermission('reacao_adversa', 'editar'), ReacaoAdversaController.store);
router.get('/reacao-adversa', checkPermission('reacao_adversa', 'acessar'), ReacaoAdversaController.index);


router.get('/dashboard', checkPermission('dashboard', 'acessar'), DashboardController.index);

export default router;