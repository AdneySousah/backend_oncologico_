import Sequelize, { Model } from "sequelize";

class EntrevistaMedicamento extends Model {
    static init(sequelize) {
        super.init({
            entrevista_profissional_id: Sequelize.INTEGER,
            medicamento_id: Sequelize.INTEGER,
        }, {
            sequelize,
            tableName: 'entrevista_medicamentos',
        });
        return this;
    }
}

export default EntrevistaMedicamento;