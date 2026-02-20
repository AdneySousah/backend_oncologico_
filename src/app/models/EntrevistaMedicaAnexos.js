import Sequelize, { Model } from "sequelize";

class EntrevistaMedicaAnexos extends Model {
    static init(sequelize) {
        super.init({
            nome: Sequelize.STRING,
            file_path: Sequelize.STRING,
            original_name: Sequelize.STRING,
        }, {
            sequelize,
            tableName: 'entrevista_medica_anexos',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.EntrevistaMedica, { foreignKey: 'entrevista_profissional_id', as: 'entrevista' });
    }
}

export default EntrevistaMedicaAnexos;