import Sequelize, { Model } from 'sequelize';

// Motivos compartilhados entre "Pausar Tratamento" (Necessidade de Navegação)
// e "Descontinuar Medicamento" (Telemonitoramento) — mesma lista, mesma
// contabilização nos dois fluxos.
class MotivoPausaTratamento extends Model {
  static init(sequelize) {
    super.init({
      descricao: Sequelize.STRING,
      ativo: Sequelize.BOOLEAN,
    }, {
      sequelize,
      tableName: 'motivos_pausa_tratamento',
    });
    return this;
  }
}

export default MotivoPausaTratamento;
